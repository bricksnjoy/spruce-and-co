import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one, q } from "./harness";

/** What the Settings and Chart of Accounts screens rely on (migration 015). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const save = (p: object) => one<{ id: string }>(db, `select rpc_save_transaction($1::jsonb) id`, [JSON.stringify(p)]).then((r) => r.id);

beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Manager', 'manager')`, [ADMIN, MANAGER]);
});

describe("account balances", () => {
  it("come from the ledger of the book you are in, in each account's natural sign", async () => {
    const c = (await one<{ id: string }>(db, `insert into contacts (name, kinds) values ('Client', '{customer}') returning id`)).id;
    await as(ADMIN, () => save({ type: "invoice", date: "2026-03-01", contact_id: c, lines: [{ account_id: null, amount: "1000.00" }] }));
    await as(ADMIN, () => db.query(`select rpc_set_book('sandbox')`));
    const tc = await as(ADMIN, async () => (await one<{ id: string }>(db, `insert into contacts (name, kinds) values ('T', '{customer}') returning id`)).id);
    await as(ADMIN, () => save({ type: "invoice", date: "2026-03-01", contact_id: tc, lines: [{ amount: "5.00" }] }));

    const bal = (rows: { code: string; balance: string }[], code: string) => rows.find((r) => r.code === code)?.balance;
    const sql = `select a.code, b.balance::text from rpc_account_balances() b join accounts a on a.id = b.account_id`;
    const live = await as(MANAGER, () => q<{ code: string; balance: string }>(db, sql));
    expect(bal(live, "1100")).toBe("1000.00");
    expect(bal(live, "4000")).toBe("1000.00");   // income shows as a positive credit balance
    const test = await as(ADMIN, () => q<{ code: string; balance: string }>(db, sql));
    expect(bal(test, "1100")).toBe("5.00");

    // a date range narrows it
    expect(await as(MANAGER, () => q(db, `select * from rpc_account_balances('2026-04-01', null)`))).toEqual([]);
  });
});

describe("numbering", () => {
  it("only an admin changes it, and never onto a number already used", async () => {
    const c = (await one<{ id: string }>(db, `insert into contacts (name, kinds) values ('Client', '{customer}') returning id`)).id;
    await as(ADMIN, () => save({ type: "invoice", date: "2026-03-01", contact_id: c, lines: [{ amount: 10 }] }));
    await expect(as(MANAGER, () => db.query(`select rpc_set_numbering('invoice', 'INV-', 5, 3)`))).rejects.toThrow(/Only an admin/);
    await as(ADMIN, () => db.query(`select rpc_set_numbering('invoice', 'SC-INV/{YY}/', 50, 4)`));
    const n = await as(ADMIN, () => save({ type: "invoice", date: "2026-03-02", contact_id: c, lines: [{ amount: 10 }] }));
    expect((await one<{ number: string }>(db, `select number from transactions where id = $1`, [n])).number).toBe("SC-INV/26/0050");

    // the Test book keeps its TEST- prefix
    await as(ADMIN, () => db.query(`select rpc_set_book('sandbox')`));
    await expect(as(ADMIN, () => db.query(`select rpc_set_numbering('invoice', 'SC-INV/{YY}/', 1, 3)`))).rejects.toThrow(/TEST-/);
  });

  it("refuses a next number that would repeat one already issued", async () => {
    const c = (await one<{ id: string }>(db, `insert into contacts (name, kinds) values ('Client', '{customer}') returning id`)).id;
    const yy = (await one<{ yy: string }>(db, `select to_char(today_mv(), 'YY') yy`)).yy;
    await as(ADMIN, () => save({ type: "invoice", date: "2026-03-01", number: `SC-INV/${yy}/001`, contact_id: c, lines: [{ amount: 10 }] }));
    await expect(as(ADMIN, () => db.query(`select rpc_set_numbering('invoice', 'SC-INV/{YY}/', 1, 3)`))).rejects.toThrow(/already used/);
  });
});

describe("rates", () => {
  it("a rate in force never changes; a new one is added from a later date", async () => {
    await expect(as(ADMIN, () => db.query(`update rates set value = 9 where kind = 'gst' and code = 'STD' and effective_from = '2023-01-01'`)))
      .rejects.toThrow(/already in force/);
    await expect(as(ADMIN, () => db.query(`delete from rates where kind = 'pension_employee'`))).rejects.toThrow(/already in force/);
    await as(ADMIN, () => db.query(`insert into rates (kind, code, value, effective_from) values ('gst', 'STD', 10, '2099-01-01')`));
    expect((await one<{ v: string }>(db, `select rate_value('gst', 'STD', '2099-06-01')::text v`)).v).toBe("10.0000");
    // a future rate can still be corrected or removed
    await as(ADMIN, () => db.query(`delete from rates where effective_from = '2099-01-01'`));
    await expect(as(MANAGER, () => db.query(`insert into rates (kind, code, value, effective_from) values ('gst', 'STD', 10, '2099-01-01')`)))
      .rejects.toThrow(/row-level security/);
  });

  it("brackets must run from zero with no gaps, ending open", async () => {
    const add = (b: object) => as(ADMIN, () => db.query(`insert into rates (kind, code, brackets, effective_from) values ('wht', 'default', $1::jsonb, '2026-01-01')`, [JSON.stringify(b)]));
    await expect(add([{ from: 0, to: 1000, rate: 0 }, { from: 2000, to: null, rate: 10 }])).rejects.toThrow(/must start where/);
    await expect(add([{ from: 0, to: 1000, rate: 0 }])).rejects.toThrow(/open-ended/);
    await expect(add([{ from: 0, to: null, rate: 150 }])).rejects.toThrow(/between 0 and 100/);
    await add([{ from: 0, to: 60000, rate: 0 }, { from: 60000, to: null, rate: 5.5 }]);
    expect((await one<{ t: string }>(db, `select bracket_tax(70000, rate_brackets('wht', 'default', '2026-02-01'))::text t`)).t).toBe("550.00");
  });

  it("takes brackets as decimal strings, the way the Taxes screen saves them", async () => {
    await as(ADMIN, () => db.query(`insert into rates (kind, code, brackets, effective_from) values ('wht', 'default', $1::jsonb, '2026-01-01')`,
      [JSON.stringify([{ from: "0.00", to: "60000.00", rate: "0" }, { from: "60000.00", to: null, rate: "5.5" }])]));
    expect((await one<{ t: string }>(db, `select bracket_tax(60000.01, rate_brackets('wht', 'default', '2026-02-01'))::text t`)).t).toBe("0.00");
    expect((await one<{ t: string }>(db, `select bracket_tax(61000, rate_brackets('wht', 'default', '2026-02-01'))::text t`)).t).toBe("55.00");
  });
});
