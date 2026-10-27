import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";
import { contact, contactId, doc, project } from "./books";

/** Directors' accounts: keep in the company or take out, then reinvest chosen amounts (migration 039). */
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
const waiting = (c: string) => val(`select coalesce(sum(amount), 0) from director_waiting($1)`, [c]);
const account = (c: string) => val(`select director_account_balance($1)`, [c]);
const bankBal = () => val(`select coalesce(sum(home_debit - home_credit), 0) from journal_lines where account_id = $1`, [bank]);
const choose = (c: string, choice: string, amount: string, b: string | null = null, uid = ADMIN) =>
  as(uid, () => db.query(`select rpc_director_choice($1, $2, $3, '2026-06-01', $4)`, [c, choice, amount, b]));

let client: string, vendor: string, mujahid: string, muaz: string, bank: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Manager', 'manager')`, [ADMIN, MANAGER]);
  client = await contact(db, "Client", ["customer"]);
  vendor = await contact(db, "Supplier", ["vendor"]);
  mujahid = await contactId(db, "Mujahid");
  muaz = await contactId(db, "Muaz");
  bank = await acct("1010");
});
afterEach(async () => { await assertHealthy(db); });

/** A project financed 200,000 by Mujahid, completed with 100,000 profit and paid in full by the client. */
async function paidProject(code: string, value = 400000, cost = 300000, from = mujahid, financed = 200000) {
  const p = await project(db, code, client, value, { start: "2026-01-01" });
  if (financed) await doc(db, { type: "capital_contribution", date: "2026-01-05", contact: from, project: p, bank: "1010", total: financed });
  const inv = await doc(db, { type: "invoice", date: "2026-03-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: value }] });
  await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: cost }] });
  await db.transaction((tx) => tx.query(`select complete_project($1, '2026-04-30')`, [p]));
  await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, bank: "1010", total: value, apply: [{ to: inv, amount: value }] });
  return p;
}

describe("a director's choice", () => {
  it("waits until the project is completed and paid, principal included", async () => {
    const p = await project(db, "D-0", client, 400000, { start: "2026-01-01" });
    await doc(db, { type: "capital_contribution", date: "2026-01-05", contact: mujahid, project: p, bank: "1010", total: 200000 });
    expect(await waiting(mujahid)).toBe("0.00");
    await paidProject("D-1");
    // principal 200,000 plus his financing return and profit share
    expect(Number(await waiting(mujahid))).toBeGreaterThan(200000);
  });

  it("keeps money in the company in the director's account, or pays it out, from what waits", async () => {
    await paidProject("D-1");
    const before = Number(await waiting(mujahid));
    const bank0 = await bankBal();
    await choose(mujahid, "keep", "150000");
    expect(await account(mujahid)).toBe("150000.00");
    expect(await bankBal()).toBe(bank0); // the cash stays in the company
    await choose(mujahid, "take", "30000", bank);
    expect(Number(await bankBal())).toBe(Number(bank0) - 30000);
    expect(Number(await waiting(mujahid))).toBeCloseTo(before - 180000, 2);
    await expect(choose(mujahid, "keep", String(before))).rejects.toThrow(/waiting; that is the most/);
    await expect(choose(mujahid, "keep", "1000", null, MANAGER)).rejects.toThrow();
  });

  it("pays out of the director's account, never more than is in it", async () => {
    await paidProject("D-1");
    await choose(mujahid, "keep", "100000");
    const bank0 = Number(await bankBal());
    await as(ADMIN, () => db.query(`select rpc_director_withdraw($1, 40000, '2026-06-02', $2)`, [mujahid, bank]));
    expect(await account(mujahid)).toBe("60000.00");
    expect(Number(await bankBal())).toBe(bank0 - 40000);
    await expect(as(ADMIN, () => db.query(`select rpc_director_withdraw($1, 60001, '2026-06-02', $2)`, [mujahid, bank]))).rejects.toThrow(/director's account; that is the most/);
  });
});

describe("financing a project from the Capital Pool", () => {
  it("takes the amount chosen from each director's account and the company, and pays it back with its share on completion", async () => {
    await paidProject("D-1");
    await choose(mujahid, "keep", "100000");
    const b = await project(db, "D-2", client, 500000, { start: "2026-06-01" });
    const companyHas = Number((await one<{ available: string }>(db, `select available::text from company_capital_available() where contact_id is null`)).available);
    expect(companyHas).toBeGreaterThan(50000);

    const parts = (xs: [string | null, number][]) => JSON.stringify(xs.map(([contact_id, amount]) => ({ contact_id, amount })));
    await expect(as(ADMIN, () => db.query(`select rpc_finance_from_capital_pool($1, '2026-06-05', $2::jsonb)`, [b, parts([[mujahid, 100001]])])))
      .rejects.toThrow(/director's account; that is the most/);
    await expect(as(ADMIN, () => db.query(`select rpc_finance_from_capital_pool($1, '2026-06-05', $2::jsonb)`, [b, parts([[null, companyHas + 1]])])))
      .rejects.toThrow(/of its own to put in/);
    await expect(as(MANAGER, () => db.query(`select rpc_finance_from_capital_pool($1, '2026-06-05', $2::jsonb)`, [b, parts([[mujahid, 1000]])]))).rejects.toThrow();

    await as(ADMIN, () => db.query(`select rpc_finance_from_capital_pool($1, '2026-06-05', $2::jsonb)`, [b, parts([[mujahid, 60000], [null, 40000]])]));
    expect(await account(mujahid)).toBe("40000.00");
    expect(await q(db, `select contact_id, received::numeric(18,2)::text r from project_financing_v where project_id = $1`, [b])).toEqual([{ contact_id: mujahid, r: "60000.00" }]);
    expect(await val(`select company_funding($1)`, [b])).toBe("40000.00");

    // on completion his 60,000 comes back to wait for his choice, with his part of the financing pool's share
    const inv = await doc(db, { type: "invoice", date: "2026-07-01", dueDate: "2026-12-31", contact: client, project: b, lines: [{ account: "4000", amount: 500000 }] });
    await doc(db, { type: "bill", date: "2026-06-10", contact: vendor, project: b, lines: [{ account: "5000", amount: 200000 }] });
    await db.transaction((tx) => tx.query(`select complete_project($1, '2026-07-31')`, [b]));
    await doc(db, { type: "customer_payment", date: "2026-08-01", contact: client, bank: "1010", total: 500000, apply: [{ to: inv, amount: 500000 }] });
    const back = await q<{ component: string; amount: string }>(db, `select component, amount::numeric(18,2)::text amount from director_waiting($1) where project_id = $2 order by component`, [mujahid, b]);
    expect(back.find((r) => r.component === "principal")?.amount).toBe("60000.00");
    // the pool's 20% of 300,000 is shared 60:40 with the company, so his return is 36,000
    expect(back.find((r) => r.component === "financing_return")?.amount).toBe("36000.00");
    // Muaz financed nothing and has only his profit share
    expect((await q<{ component: string }>(db, `select component from director_waiting($1) where project_id = $2`, [muaz, b])).map((r) => r.component)).toEqual(["profit_share"]);
  });
});
