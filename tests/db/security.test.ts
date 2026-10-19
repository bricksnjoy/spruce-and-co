import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/**
 * Live and Test never mix (decision Q2), and the database — not just the
 * screens — decides who sees and changes what (§1, §7, audit A-06).
 */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";
const VIEWER = "00000000-0000-0000-0000-00000000000c";

/** Run as a signed-in user through the API role, exactly as the app will. */
async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const save = (p: object) => one<{ id: string }>(db, `select rpc_save_transaction($1::jsonb) id`, [JSON.stringify(p)]).then((r) => r.id);
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;

beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Manager', 'manager'), ($3, 'Viewer', 'viewer')`, [ADMIN, MANAGER, VIEWER]);
});

describe("Live and Test are never mixed", () => {
  it("each book sees only its own records, with its own numbering", async () => {
    const liveClient = (await one<{ id: string }>(db, `insert into contacts (name, kinds) values ('Real Client', '{customer}') returning id`)).id;
    const rev = await acct("4000");
    const liveInv = await as(ADMIN, () => save({ type: "invoice", date: "2026-03-01", contact_id: liveClient, lines: [{ account_id: rev, amount: 1000 }] }));
    await as(ADMIN, () => db.query(`select rpc_set_book('sandbox')`));
    const testClient = await as(ADMIN, async () => (await one<{ id: string }>(db, `insert into contacts (name, kinds) values ('Test Client', '{customer}') returning id`)).id);
    const testInv = await as(ADMIN, () => save({ type: "invoice", date: "2026-03-01", contact_id: testClient, lines: [{ account_id: rev, amount: 500 }] }));

    const numbers = await q<{ number: string; book: string }>(db, `select number, book from transactions order by book`);
    expect(numbers).toEqual([{ number: "SC-INV/26/001", book: "live" }, { number: "TEST-SC-INV/26/001", book: "sandbox" }]);

    // the admin, now in Test, sees only test records; the manager, in Live, only live ones
    expect((await as(ADMIN, () => q<{ id: string }>(db, `select id from transactions`))).map((r) => r.id)).toEqual([testInv]);
    expect((await as(ADMIN, () => q<{ name: string }>(db, `select name from contacts where name like '%Client'`))).map((r) => r.name)).toEqual(["Test Client"]);
    expect((await as(MANAGER, () => q<{ id: string }>(db, `select id from transactions`))).map((r) => r.id)).toEqual([liveInv]);
    expect(await as(MANAGER, () => q(db, `select 1 from journal_lines where book = 'sandbox'`))).toEqual([]);

    // a test invoice cannot point at a live customer, and a live user cannot touch a test document
    await expect(as(ADMIN, () => save({ type: "invoice", date: "2026-03-02", contact_id: liveClient, lines: [{ account_id: rev, amount: 1 }] })))
      .rejects.toThrow(/other book/);
    await expect(as(MANAGER, () => db.query(`select rpc_void($1, 'x')`, [testInv]))).rejects.toThrow(/other book/);

    // each book is healthy on its own
    await assertHealthy(db);
    expect(await q(db, `select * from health_check('sandbox') where not ok`)).toEqual([]);
  });

  it("an admin can wipe the Test book; Live is untouched", async () => {
    const rev = await acct("4000");
    const live = (await one<{ id: string }>(db, `insert into contacts (name, kinds) values ('Real', '{customer}') returning id`)).id;
    await as(ADMIN, () => save({ type: "invoice", date: "2026-03-01", contact_id: live, lines: [{ account_id: rev, amount: 1000 }] }));
    await as(ADMIN, async () => {
      await db.query(`select rpc_set_book('sandbox')`);
      const c = (await one<{ id: string }>(db, `insert into contacts (name, kinds) values ('Fake', '{customer}') returning id`)).id;
      const p = (await one<{ id: string }>(db, `insert into projects (code, name) values ('T-1', 'Try') returning id`)).id;
      await save({ type: "invoice", date: "2026-03-01", contact_id: c, project_id: p, lines: [{ account_id: rev, amount: 700, project_id: p }] });
    });
    await expect(as(MANAGER, () => db.query(`select rpc_reset_test_book()`))).rejects.toThrow(/Only an admin/);
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('app.uid', $1, true)`, [ADMIN]);
      await tx.query(`select rpc_reset_test_book()`);
    });
    const left = await one<{ t: string; c: string; p: string; j: string }>(db,
      `select (select count(*) from transactions where book = 'sandbox') t, (select count(*) from contacts where book = 'sandbox') c,
              (select count(*) from projects where book = 'sandbox') p, (select count(*) from journal_lines where book = 'sandbox') j`);
    expect([left.t, left.c, left.p, left.j].map(Number)).toEqual([0, 0, 0, 0]);
    expect(Number((await one<{ n: string }>(db, `select count(*) n from transactions where book = 'live'`)).n)).toBe(1);
    await assertHealthy(db);
  });
});

describe("the database enforces roles", () => {
  it("a viewer can read but not change the books; nobody writes the ledger directly", async () => {
    const c = (await one<{ id: string }>(db, `insert into contacts (name, kinds) values ('Client', '{customer}') returning id`)).id;
    const rev = await acct("4000");
    await expect(as(VIEWER, () => save({ type: "invoice", date: "2026-03-01", contact_id: c, lines: [{ account_id: rev, amount: 1 }] })))
      .rejects.toThrow(/view but not change/);
    await expect(as(MANAGER, () => db.query(`insert into journal_lines (transaction_id, line_no, date, account_id, debit, book)
      values (gen_random_uuid(), 1, '2026-01-01', $1, 1, 'live')`, [rev]))).rejects.toThrow(/permission denied/);
    await expect(as(MANAGER, () => db.query(`select post_transaction(gen_random_uuid())`))).rejects.toThrow(/permission denied/);
  });

  it("payroll is visible only with payroll permission, and only an admin approves a run", async () => {
    await db.query(`insert into employees (name, basic_salary) values ('Ahmed', 10000)`);
    expect(await as(MANAGER, () => q(db, `select * from employees`))).toEqual([]);
    expect((await as(ADMIN, () => q(db, `select * from employees where name = 'Ahmed'`))).length).toBe(1);
    await expect(as(MANAGER, () => db.query(`select rpc_create_payroll_run('2026-03-01', '2026-03-31')`))).rejects.toThrow(/payroll permission/);
    // a finance user with payroll permission can prepare a run but not approve it
    await db.query(`update profiles set role = 'finance' where id = $1`, [MANAGER]);
    await db.query(`insert into rates (kind, code, brackets, effective_from) values ('wht', 'default', '[{"from": 0, "to": null, "rate": 0}]', '2020-01-01')`);
    const run = await as(MANAGER, async () => (await one<{ id: string }>(db, `select rpc_create_payroll_run('2026-03-01', '2026-03-31') id`)).id);
    await expect(as(MANAGER, () => db.query(`select rpc_approve_payroll_run($1)`, [run]))).rejects.toThrow(/Only an admin/);
  });
});
