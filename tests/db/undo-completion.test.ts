import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";
import { contact, contactId, doc, project } from "./books";

/** Undoing a project's completion (migration 038). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;
const undo = (uid: string, p: string) => as(uid, () => db.query(`select rpc_undo_completion($1)`, [p]));
// what the project's profit split has made payable, across everyone
const payable = (p: string) => one<{ v: string }>(db, `select coalesce(sum(j.home_credit - j.home_debit), 0)::numeric(18,2)::text v
  from journal_lines j join accounts a on a.id = j.account_id join accounts par on par.id = a.parent_id
  where j.project_id = $1 and par.subtype in ('profit_share_payable', 'financing_return_payable')`, [p]).then((r) => r.v);

// what the split of the project's profit today would make payable
const splitNow = (p: string) => one<{ v: string }>(db, `select coalesce(sum(amount), 0)::numeric(18,2)::text v from split_profit($1, project_profit($1))`, [p]).then((r) => r.v);

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

/** A completed project: profit 100,000, financed 200,000 by Mujahid. */
async function completedProject() {
  const p = await project(db, "U-1", client, 400000, { start: "2026-01-01" });
  await doc(db, { type: "capital_contribution", date: "2026-01-05", contact: mujahid, project: p, bank: "1010", total: 200000 });
  const inv = await doc(db, { type: "invoice", date: "2026-03-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 400000 }] });
  await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 300000 }] });
  await db.transaction((tx) => tx.query(`select complete_project($1, '2026-04-30')`, [p]));
  return { p, inv };
}

describe("undoing a completion", () => {
  it("reverses the profit split, sets the project back to active, and it can be completed again", async () => {
    const { p } = await completedProject();
    const atCompletion = await payable(p);
    expect(Number(atCompletion)).toBeGreaterThan(0);
    // a late cost adjusts the split while completed
    await doc(db, { type: "bill", date: "2026-05-02", contact: vendor, project: p, lines: [{ account: "5000", amount: 10000 }] });
    expect(Number(await payable(p))).toBeLessThan(Number(atCompletion));

    await undo(ADMIN, p);
    expect(await payable(p)).toBe("0.00");
    expect(await one(db, `select completed_at, status::text, project_stage(id) stage from projects where id = $1`, [p]))
      .toEqual({ completed_at: null, status: "in_progress", stage: "active" });
    // the split entries stay in the books as void
    expect(await q(db, `select count(*)::int n from transactions where type = 'distribution' and project_id = $1 and voided_at is not null`, [p])).toEqual([{ n: 2 }]);
    expect(await q(db, `select count(*)::int n from distributions where project_id = $1`, [p])).toEqual([{ n: 0 }]);

    // a cost now is an ordinary cost: no split to adjust
    await doc(db, { type: "bill", date: "2026-05-03", contact: vendor, project: p, lines: [{ account: "5000", amount: 5000 }] });
    expect(await payable(p)).toBe("0.00");
    await db.transaction((tx) => tx.query(`select complete_project($1, '2026-05-31')`, [p]));
    expect(await payable(p)).toBe(await splitNow(p));
    expect(Number(await payable(p))).toBeLessThan(Number(atCompletion));
  });

  it("is refused once profit from the project has been paid out, until that payout is voided", async () => {
    const { p, inv } = await completedProject();
    await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });
    const pay = (await as(ADMIN, () => one<{ id: string }>(db, `select rpc_save_payout($1::jsonb) id`, [JSON.stringify({
      date: "2026-06-01", contact_id: mujahid, bank_account_id: bank, lines: [{ project_id: p, component: "financing_return", amount: 20000 }] })]))).id;
    await expect(undo(ADMIN, p)).rejects.toThrow(/has been paid out/);
    await as(ADMIN, () => db.query(`select rpc_void($1, 'wrong')`, [pay]));
    await undo(ADMIN, p);
    expect(await payable(p)).toBe("0.00");
  });

  it("is for admins only, and only for a completed project", async () => {
    const { p } = await completedProject();
    await expect(undo(MANAGER, p)).rejects.toThrow();
    await undo(ADMIN, p);
    await expect(undo(ADMIN, p)).rejects.toThrow(/not completed/);
  });
});
