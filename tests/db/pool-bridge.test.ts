import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";
import { contact, contactId, doc, project } from "./books";

/** Repaying a loan from the Capital Pool (a bridge), and settling one project at a time (migration 054). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;
const val = (sql: string, params: unknown[] = []) => one<{ v: string }>(db, `select (${sql})::numeric(18,2)::text v`, params).then((r) => r.v);
const account = (c: string) => val(`select director_account_balance($1)`, [c]);
const bankBal = () => val(`select coalesce(sum(home_debit - home_credit), 0) from journal_lines where account_id = $1`, [bank]);
const owed = (c: string, p: string, component: string) =>
  val(`select coalesce(sum(owed), 0) from owed_on_project($1, $2) where component = $3`, [c, p, component]);
const companyHas = () => val(`select available from company_capital_available() where contact_id is null`);
const split = (p: string) => q<{ contact_id: string; component: string; amount: string }>(db,
  `select contact_id, component, amount::text from split_profit($1, project_profit($1)) order by contact_id, component`, [p]);
const bridge = (lender: string, p: string, parts: { contact_id: string | null; amount: number }[], uid = ADMIN, date = "2026-05-01") =>
  as(uid, () => one<{ id: string }>(db, `select rpc_repay_from_capital_pool($1, $2, $3, $4, $5::jsonb) id`, [lender, p, date, bank, JSON.stringify(parts)]));
const settle = (c: string, p: string, what: string, choice: string, amount: number | string, uid = ADMIN) =>
  as(uid, () => one<{ id: string }>(db, `select rpc_settle($1, $2, $3, $4, $5, '2026-07-01', $6) id`, [c, p, what, choice, amount, choice === "take" ? bank : null]));

let client: string, vendor: string, lender: string, mujahid: string, bank: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Manager', 'manager')`, [ADMIN, MANAGER]);
  client = await contact(db, "Client", ["customer"]);
  vendor = await contact(db, "Supplier", ["vendor"]);
  lender = await contact(db, "Bank of Friends", ["lender"]);
  mujahid = await contactId(db, "Mujahid");
  bank = await acct("1010");
});
afterEach(async () => { await assertHealthy(db); });

/** Mujahid has 100,000 kept in his director's account, from an earlier project. */
async function mujahidKeeps() {
  const p = await project(db, "D-1", client, 400000, { start: "2026-01-01" });
  await doc(db, { type: "capital_contribution", date: "2026-01-05", contact: mujahid, project: p, bank: "1010", total: 200000 });
  const inv = await doc(db, { type: "invoice", date: "2026-02-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 400000 }] });
  await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 300000 }] });
  await db.transaction((tx) => tx.query(`select complete_project($1, '2026-02-28')`, [p]));
  await doc(db, { type: "customer_payment", date: "2026-03-01", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });
  // his loan back first, kept; then 100,000 of it stays, the rest is taken out
  await settle(mujahid, p, "principal", "keep", 200000);
  await as(ADMIN, () => db.query(`select rpc_director_withdraw($1, 100000, '2026-03-02', $2)`, [mujahid, bank]));
  expect(await account(mujahid)).toBe("100000.00");
}

/** A lender's 50,000 in a project billed 300,000 with 200,000 of costs, completed, the client not paid yet. */
async function lentProject() {
  const p = await project(db, "B-1", client, 300000, { start: "2026-03-01" });
  await doc(db, { type: "loan_receipt", date: "2026-03-05", contact: lender, project: p, bank: "1010", total: 50000 });
  const inv = await doc(db, { type: "invoice", date: "2026-04-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 300000 }] });
  const bill = await doc(db, { type: "bill", date: "2026-03-10", contact: vendor, project: p, lines: [{ account: "5000", amount: 200000 }] });
  await as(ADMIN, () => db.query(`select rpc_pay_bills($1, '2026-03-20', $2::jsonb)`, [bank, JSON.stringify([{ bill, amount: "200000.00" }])]));
  await db.transaction((tx) => tx.query(`select complete_project($1, '2026-04-30')`, [p]));
  return { p, inv };
}

describe("repaying a loan from the Capital Pool", () => {
  it("repays the lender before the client pays; the bridge earns no share and is paid back to the pool once the client pays", async () => {
    await mujahidKeeps();
    const { p, inv } = await lentProject();
    const splitBefore = await split(p);
    const lenderReturn = Number(await owed(lender, p, "financing_return"));
    expect(lenderReturn).toBeGreaterThan(0);
    // from the project's money it waits for the client
    await expect(settle(lender, p, "principal", "take", 50000)).rejects.toThrow(/client still owes/);

    const bank0 = Number(await bankBal()), company0 = Number(await companyHas());
    await expect(bridge(lender, p, [{ contact_id: mujahid, amount: 30000 }, { contact_id: null, amount: 20000 }], MANAGER)).rejects.toThrow();
    await bridge(lender, p, [{ contact_id: mujahid, amount: 30000 }, { contact_id: null, amount: 20000 }]);
    // the lender is repaid from the bank; the pool's money now waits in the project
    expect(await owed(lender, p, "principal")).toBe("0.00");
    expect(Number(await bankBal())).toBe(bank0 - 50000);
    expect(await account(mujahid)).toBe("70000.00");
    expect(await owed(mujahid, p, "principal")).toBe("30000.00");
    expect(Number(await companyHas())).toBe(company0 - 20000);
    // and earns nothing: the split is as it was, and the lender keeps the return their loan earned
    expect(await split(p)).toEqual(splitBefore);
    expect(await val(`select company_financing_return($1, project_profit($1))`, [p])).toBe("0.00");
    expect(Number(await owed(lender, p, "financing_return"))).toBe(lenderReturn);

    // the client pays: the pool is paid back first (loans first), then the lender's return
    await doc(db, { type: "customer_payment", date: "2026-06-01", contact: client, bank: "1010", total: 300000, apply: [{ to: inv, amount: 300000 }] });
    await expect(settle(lender, p, "earnings", "take", lenderReturn)).rejects.toThrow(/Repay the loans first: MVR 30,000.00/);
    await settle(mujahid, p, "principal", "keep", 30000);
    expect(await account(mujahid)).toBe("100000.00");
    expect(Number(await companyHas())).toBeGreaterThanOrEqual(company0);
    await settle(lender, p, "earnings", "take", lenderReturn);
    expect(await owed(lender, p, "financing_return")).toBe("0.00");
  });

  it("is refused once the client has paid, for more than the loan, or for more than each part has", async () => {
    await mujahidKeeps();
    const { p, inv } = await lentProject();
    await expect(bridge(lender, p, [{ contact_id: mujahid, amount: 50001 }])).rejects.toThrow(/50,000.00 of their loan/);
    await expect(bridge(lender, p, [{ contact_id: mujahid, amount: 100001 }, { contact_id: null, amount: 0 }])).rejects.toThrow(/of their loan/);
    const lent = await project(db, "B-2", client, 1000000, { start: "2026-03-01" });
    await doc(db, { type: "loan_receipt", date: "2026-03-05", contact: lender, project: lent, bank: "1010", total: 150000 });
    await doc(db, { type: "invoice", date: "2026-04-01", dueDate: "2026-12-31", contact: client, project: lent, lines: [{ account: "4000", amount: 1000 }] });
    await expect(bridge(lender, lent, [{ contact_id: mujahid, amount: 100001 }])).rejects.toThrow(/director's account; that is the most/);
    await expect(bridge(lender, lent, [{ contact_id: null, amount: 1e9 }])).rejects.toThrow(/of their loan/);
    await expect(bridge(lender, p, [{ contact_id: null, amount: 1 }], ADMIN, "")).rejects.toThrow();
    // nothing moved
    expect(await account(mujahid)).toBe("100000.00");
    expect(await q(db, `select 1 from pool_bridges`)).toEqual([]);
    await doc(db, { type: "customer_payment", date: "2026-06-01", contact: client, bank: "1010", total: 300000, apply: [{ to: inv, amount: 300000 }] });
    await expect(bridge(lender, p, [{ contact_id: mujahid, amount: 1000 }])).rejects.toThrow(/client has paid/);
  });
});

describe("settling one project", () => {
  it("takes out or keeps a director's loan and earnings, loans first, the return before the share", async () => {
    const p = await project(db, "S-1", client, 400000, { start: "2026-01-01" });
    await doc(db, { type: "capital_contribution", date: "2026-01-05", contact: mujahid, project: p, bank: "1010", total: 200000 });
    const inv = await doc(db, { type: "invoice", date: "2026-02-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 400000 }] });
    await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 300000 }] });
    await db.transaction((tx) => tx.query(`select complete_project($1, '2026-02-28')`, [p]));
    await doc(db, { type: "customer_payment", date: "2026-03-01", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });
    const ret = Number(await owed(mujahid, p, "financing_return")), share = Number(await owed(mujahid, p, "profit_share"));
    expect(ret).toBeGreaterThan(0);
    expect(share).toBeGreaterThan(0);

    await expect(settle(mujahid, p, "earnings", "take", ret)).rejects.toThrow(/Repay the loans first/);
    await expect(settle(mujahid, p, "principal", "take", 200001)).rejects.toThrow(/more than the MVR 200,000.00 owed/);
    await settle(mujahid, p, "principal", "keep", 200000);
    expect(await account(mujahid)).toBe("200000.00");
    // part of the earnings: the financing return goes first
    const bank0 = Number(await bankBal());
    await settle(mujahid, p, "earnings", "take", ret + 100);
    expect(Number(await bankBal())).toBe(bank0 - ret - 100);
    expect(await owed(mujahid, p, "financing_return")).toBe("0.00");
    expect(Number(await owed(mujahid, p, "profit_share"))).toBe(share - 100);
    await settle(mujahid, p, "earnings", "keep", share - 100);
    expect(Number(await account(mujahid))).toBe(200000 + share - 100);
    expect(await q(db, `select component from owed_on_project($1, $2) where owed <> 0`, [mujahid, p])).toEqual([]);
  });

  it("keeps only a director's money in the company; a manager's waits for an admin", async () => {
    const { p, inv } = await lentProject();
    await doc(db, { type: "customer_payment", date: "2026-06-01", contact: client, bank: "1010", total: 300000, apply: [{ to: inv, amount: 300000 }] });
    await expect(settle(lender, p, "principal", "keep", 50000)).rejects.toThrow(/Only a director/);
    const { id } = await settle(lender, p, "principal", "take", 50000, MANAGER);
    expect(await one(db, `select is_draft, approval_status from transactions where id = $1`, [id])).toEqual({ is_draft: true, approval_status: "pending" });
    expect(await owed(lender, p, "principal")).toBe("50000.00");
    await as(ADMIN, () => db.query(`select rpc_approve_payout($1)`, [id]));
    expect(await owed(lender, p, "principal")).toBe("0.00");
  });
});
