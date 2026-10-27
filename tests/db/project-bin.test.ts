import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";
import { contact, contactId, doc, project } from "./books";

/** Deleting a project with all its information, and restoring it within 30 days (migration 040). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;
const del = (p: string, code: string, uid = ADMIN) => as(uid, () => db.query(`select rpc_delete_project($1, $2)`, [p, code]));
const restore = (p: string) => as(ADMIN, () => db.query(`select rpc_restore_project($1)`, [p]));
const bankBal = async () => Number((await one<{ v: string }>(db, `select coalesce(sum(home_debit - home_credit), 0) v from journal_lines where account_id = $1`, [bank])).v);
// what the people using the app can see of it: the project, and the documents headed to it
// (financing, invoice, bill and profit split; its payments and payout are linked by their lines)
const seen = (p: string) => as(ADMIN, async () => ({
  project: (await q(db, `select id from projects where id = $1`, [p])).length,
  docs: (await q(db, `select id from transactions where project_id = $1`, [p])).length,
}));
const payable = async (p: string) => Number((await one<{ v: string }>(db, `select coalesce(sum(j.home_credit - j.home_debit), 0) v
  from journal_lines j join accounts a on a.id = j.account_id join accounts par on par.id = a.parent_id
  where j.project_id = $1 and par.subtype in ('profit_share_payable', 'financing_return_payable', 'capital_pool_loans')`, [p])).v);

let client: string, vendor: string, mujahid: string, bank: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Manager', 'manager')`, [ADMIN, MANAGER]);
  client = await contact(db, "Client", ["customer"]);
  vendor = await contact(db, "Supplier", ["vendor"]);
  mujahid = await contactId(db, "Mujahid");
  bank = await acct("1010");
});
afterEach(async () => { await assertHealthy(db); });

/** Financed 200,000 by Mujahid, billed 400,000 and paid, a bill paid, completed, and a payout made. */
async function fullProject(code = "X-1") {
  const p = await project(db, code, client, 400000, { start: "2026-01-01" });
  await doc(db, { type: "capital_contribution", date: "2026-01-05", contact: mujahid, project: p, bank: "1010", total: 200000 });
  const inv = await doc(db, { type: "invoice", date: "2026-03-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 400000 }] });
  const bill = await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 300000 }] });
  await as(ADMIN, () => db.query(`select rpc_pay_bills($1, '2026-02-20', $2::jsonb)`, [bank, JSON.stringify([{ bill, amount: "300000.00" }])]));
  await db.transaction((tx) => tx.query(`select complete_project($1, '2026-04-30')`, [p]));
  await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });
  await as(ADMIN, () => db.query(`select rpc_director_choice($1, 'take', 10000, '2026-06-01', $2)`, [mujahid, bank]));
  return p;
}

describe("deleting a project", () => {
  it("takes everything with it, and restoring puts it all back as it was", async () => {
    const bank0 = await bankBal();
    const p = await fullProject();
    const bankFull = await bankBal();
    const owedFull = await payable(p);
    expect(await seen(p)).toEqual({ project: 1, docs: 4 });

    await expect(del(p, "X-2")).rejects.toThrow(/Type the project code X-1/);
    await expect(del(p, "X-1", MANAGER)).rejects.toThrow();
    await del(p, "X-1");
    expect(await seen(p)).toEqual({ project: 0, docs: 0 });
    expect(await bankBal()).toBe(bank0); // every receipt and payment of it is undone
    expect(await payable(p)).toBe(0);
    expect(await q(db, `select count(*)::int n from distributions where project_id = $1`, [p])).toEqual([{ n: 0 }]);
    expect((await as(ADMIN, () => q<{ code: string }>(db, `select code from deleted_projects()`))).map((r) => r.code)).toEqual(["X-1"]);
    await assertHealthy(db);

    await restore(p);
    expect(await seen(p)).toEqual({ project: 1, docs: 4 });
    expect(await bankBal()).toBe(bankFull);
    expect(await payable(p)).toBe(owedFull);
    expect(await one(db, `select project_stage(id) stage, completed_at::date::text d from projects where id = $1`, [p])).toEqual({ stage: "settled", d: "2026-04-30" });
    expect(await q(db, `select count(*)::int n from project_bin`)).toEqual([{ n: 0 }]);
  });

  it("can no longer be restored after 30 days, and stays out of sight", async () => {
    const p = await fullProject();
    await del(p, "X-1");
    await db.query(`update project_bin set deleted_at = now() - interval '31 days'`);
    await expect(restore(p)).rejects.toThrow(/over 30 days/);
    expect(await as(ADMIN, () => q(db, `select * from deleted_projects()`))).toEqual([]);
    expect(await seen(p)).toEqual({ project: 0, docs: 0 });
  });

  it("is refused while a document or payment also belongs to another project", async () => {
    const a = await project(db, "A-1", client, 100000, { start: "2026-01-01" });
    const b = await project(db, "B-1", client, 100000, { start: "2026-01-01" });
    const b1 = await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: a, lines: [{ account: "5000", amount: 1000 }] });
    const b2 = await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: b, lines: [{ account: "5000", amount: 2000 }] });
    await as(ADMIN, () => db.query(`select rpc_pay_bills($1, '2026-02-20', $2::jsonb)`,
      [bank, JSON.stringify([{ bill: b1, amount: "1000.00" }, { bill: b2, amount: "2000.00" }])]));
    await expect(del(a, "A-1")).rejects.toThrow(/also pay documents of another project/);
    await doc(db, { type: "expense", date: "2026-02-02", bank: "1010", project: a, lines: [{ account: "5000", amount: 50, project: a }, { account: "5000", amount: 70, project: b }] });
    await expect(del(a, "A-1")).rejects.toThrow(/also belong to another project/);
    expect(await seen(a)).toEqual({ project: 1, docs: 2 });
  });

  it("is refused when a director's account has already used money from it", async () => {
    const p = await fullProject();
    await as(ADMIN, () => db.query(`select rpc_director_choice($1, 'keep', 50000, '2026-06-02')`, [mujahid]));
    const next = await project(db, "N-1", client, 100000, { start: "2026-06-01" });
    await as(ADMIN, () => db.query(`select rpc_finance_from_capital_pool($1, '2026-06-05', $2::jsonb)`, [next, JSON.stringify([{ contact_id: mujahid, amount: 50000 }])]));
    await expect(del(p, "X-1")).rejects.toThrow(/already been used: Mujahid/);
    // the project it went into can go: the money goes back into his account
    await del(next, "N-1");
    expect(Number((await one<{ v: string }>(db, `select director_account_balance($1) v`, [mujahid])).v)).toBe(50000);
    await restore(next);
    expect(Number((await one<{ v: string }>(db, `select director_account_balance($1) v`, [mujahid])).v)).toBe(0);
  });
});
