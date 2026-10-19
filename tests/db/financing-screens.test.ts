import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";
import { contact, contactId, doc, project } from "./books";

/** Financing screens: payout approval, scheme versions, the payouts view (migration 025). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;

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

/** A completed, fully paid project: profit 100,000 financed 200,000 by Mujahid. */
async function settledProject(code = "F-1", start = "2026-01-01") {
  const p = await project(db, code, client, 400000, { start });
  await doc(db, { type: "capital_contribution", date: "2026-01-05", contact: mujahid, project: p, bank: "1010", total: 200000 });
  const inv = await doc(db, { type: "invoice", date: "2026-03-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 400000 }] });
  await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 300000 }] });
  await db.transaction((tx) => tx.query(`select complete_project($1, '2026-04-30')`, [p]));
  return { p, inv };
}
const payoutJson = (p: string, lines: [string, number][]) => JSON.stringify({
  date: "2026-06-01", contact_id: mujahid, bank_account_id: bank, lines: lines.map(([component, amount]) => ({ project_id: p, component, amount })),
});

describe("payouts need an admin's approval", () => {
  it("a manager's payout waits for approval; the admin approves and it is paid", async () => {
    const { p, inv } = await settledProject();
    await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });
    const id = (await as(MANAGER, () => one<{ id: string }>(db, `select rpc_save_payout($1::jsonb) id`, [payoutJson(p, [["principal", 200000], ["profit_share", 25000]])]))).id;
    const draft = await one<{ is_draft: boolean; approval_status: string }>(db, `select is_draft, approval_status from transactions where id = $1`, [id]);
    expect(draft).toEqual({ is_draft: true, approval_status: "pending" });
    expect((await q(db, `select 1 from journal_lines where transaction_id = $1`, [id])).length).toBe(0);
    await expect(as(MANAGER, () => db.query(`select rpc_approve_payout($1)`, [id]))).rejects.toThrow(/Only an admin/);
    // posting it any other way is refused
    await expect(as(MANAGER, () => db.query(`select rpc_save_transaction($1::jsonb)`,
      [JSON.stringify({ type: "payout", date: "2026-06-02", contact_id: mujahid, bank_account_id: bank, total_amount: 1,
        lines: [{ project_id: p, component: "profit_share", amount: 1, contact_id: mujahid }] })]))).rejects.toThrow(/approval/);
    await as(ADMIN, () => db.query(`select rpc_approve_payout($1)`, [id]));
    const bal = await one<{ b: string }>(db, `select sum(home_debit - home_credit)::text b from journal_lines where transaction_id = $1 and account_id = $2`, [id, bank]);
    expect(Number(bal.b)).toBe(-225000);
    const st = await q<{ component: string; paid: string; outstanding: string }>(db,
      `select component, paid, outstanding from partner_statement_v where contact_id = $1 and project_id = $2 order by component`, [mujahid, p]);
    expect(st.map((r) => [r.component, Number(r.paid), Number(r.outstanding)])).toEqual([
      ["financing_return", 0, 20000], ["principal", 200000, 0], ["profit_share", 25000, 0]]);
  });

  it("an admin's payout is approved as it is saved, and the payout gate still applies", async () => {
    const { p, inv } = await settledProject();
    await expect(as(ADMIN, () => db.query(`select rpc_save_payout($1::jsonb)`, [payoutJson(p, [["financing_return", 20000]])])))
      .rejects.toThrow(/client still owes MVR 400,000.00/);
    await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });
    const id = (await as(ADMIN, () => one<{ id: string }>(db, `select rpc_save_payout($1::jsonb) id`, [payoutJson(p, [["financing_return", 20000]])]))).id;
    const t = await one<{ is_draft: boolean; approval_status: string }>(db, `select is_draft, approval_status from transactions where id = $1`, [id]);
    expect(t).toEqual({ is_draft: false, approval_status: "approved" });
  });

  it("an approved payout cannot be changed to pay something else", async () => {
    const { p, inv } = await settledProject();
    await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });
    const id = (await as(ADMIN, () => one<{ id: string }>(db, `select rpc_save_payout($1::jsonb) id`, [payoutJson(p, [["profit_share", 25000]])]))).id;
    await expect(db.transaction(async (tx) => {
      await tx.query(`update transaction_lines set amount = 20000 where transaction_id = $1`, [id]);
      await tx.query(`update transactions set updated_at = now() where id = $1`, [id]);
    })).rejects.toThrow(/approval/);
    await expect(as(MANAGER, () => db.query(`select rpc_save_payout($1::jsonb)`,
      [JSON.stringify({ ...JSON.parse(payoutJson(p, [["profit_share", 1]])), id })]))).rejects.toThrow(/awaiting approval/);
  });
});

describe("profit-share scheme versions", () => {
  const alloc = [{ party_type: "financing_pool", percent: 30 }, { party_type: "company", percent: 70 }];
  it("an admin adds a version; projects starting from its date and not yet split move to it", async () => {
    const early = await project(db, "E-1", client, 1000, { start: "2026-01-01" });
    const later = await project(db, "L-1", client, 1000, { start: "2026-08-01" });
    await expect(as(MANAGER, () => db.query(`select rpc_save_scheme($1::jsonb)`,
      [JSON.stringify({ name: "2026 H2", effective_from: "2026-07-01", allocations: alloc })]))).rejects.toThrow(/Only an admin/);
    await expect(as(ADMIN, () => db.query(`select rpc_save_scheme($1::jsonb)`,
      [JSON.stringify({ name: "Bad", effective_from: "2026-07-01", allocations: [{ party_type: "company", percent: 90 }] })]))).rejects.toThrow(/total 100/);
    const s = (await as(ADMIN, () => one<{ id: string }>(db, `select rpc_save_scheme($1::jsonb) id`,
      [JSON.stringify({ name: "2026 H2", effective_from: "2026-07-01", allocations: alloc })]))).id;
    const scheme = async (p: string) => (await one<{ scheme_id: string }>(db, `select scheme_id from projects where id = $1`, [p])).scheme_id;
    expect(await scheme(later)).toBe(s);
    expect(await scheme(early)).not.toBe(s);
    // removing it puts the project back on the version before
    await as(ADMIN, () => db.query(`select rpc_delete_scheme($1)`, [s]));
    expect(await scheme(later)).toBe(await scheme(early));
  });

  it("a version cannot start before a project already split, and a version used by a split is kept", async () => {
    await settledProject("S-1", "2026-03-01");
    await expect(as(ADMIN, () => db.query(`select rpc_save_scheme($1::jsonb)`,
      [JSON.stringify({ name: "Back-dated", effective_from: "2026-02-01", allocations: alloc })]))).rejects.toThrow(/already been split/);
    const current = (await one<{ scheme_id: string }>(db, `select scheme_id from distributions limit 1`)).scheme_id;
    await as(ADMIN, () => db.query(`select rpc_save_scheme($1::jsonb)`, [JSON.stringify({ name: "Next", effective_from: "2027-01-01", allocations: alloc })]));
    await expect(as(ADMIN, () => db.query(`select rpc_delete_scheme($1)`, [current]))).rejects.toThrow(/kept/);
  });
});

describe("the payouts view", () => {
  it("shows financing, what is still owed, and why payouts are blocked", async () => {
    const { p, inv } = await settledProject();
    type Row = { financed: string; principal_outstanding: string; returns_outstanding: string; split_profit: string; blocked: boolean; blocked_reason: string | null; stage: string };
    const row = () => as(ADMIN, () => one<Row>(db, `select * from project_payouts_v where id = $1`, [p]));
    let r = await row();
    expect([Number(r.financed), Number(r.principal_outstanding), Number(r.returns_outstanding), Number(r.split_profit)]).toEqual([200000, 200000, 70000, 100000]);
    expect(r.blocked).toBe(true);
    expect(r.blocked_reason).toMatch(/owes MVR 400,000.00/);
    await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });
    r = await row();
    expect([r.blocked, r.stage]).toEqual([false, "settled"]);
  });
});
