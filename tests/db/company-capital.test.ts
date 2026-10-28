import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";
import { balance, contact, contactId, doc, project } from "./books";

/** Financing a project from the Capital Pool: what directors keep in the company and the company's own money (030, 039, 042). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const available = () => as(ADMIN, () => q<{ name: string; available: string }>(db, `select name, available from company_capital_available()`))
  .then((r) => r.map((x) => [x.name, Number(x.available)]));
// each part as chosen: [contact id or null for the company, amount]
const finance = (p: string, parts: [string | null, number][], uid = ADMIN) => as(uid, async () =>
  (await one<{ r: { name: string; amount: number }[] }>(db, `select rpc_finance_from_capital_pool($1, '2026-06-01', $2::jsonb) r`,
    [p, JSON.stringify(parts.map(([contact_id, amount]) => ({ contact_id, amount })))])).r);
// a director keeps all that waits for them in the company
const keepAll = async (c: string) => {
  const w = Number((await one<{ w: string }>(db, `select coalesce(sum(amount), 0) w from director_waiting($1)`, [c])).w);
  if (w > 0) await as(ADMIN, () => db.query(`select rpc_director_choice($1, 'keep', $2, '2026-05-20')`, [c, w]));
  return w;
};
const ids = async () => Promise.all(["Mujahid", "Muaz", "Mushahid", "Mariyam Zahir"].map((n) => contactId(db, n)));

let client: string, vendor: string, mujahid: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Manager', 'manager')`, [ADMIN, MANAGER]);
  client = await contact(db, "Client", ["customer"]);
  vendor = await contact(db, "Supplier", ["vendor"]);
  mujahid = await contactId(db, "Mujahid");
});
afterEach(async () => { await assertHealthy(db); });

/** A completed project with profit 100,000, its shares owed to the directors and its supplier still to pay; paid in full by the client when `paid`. */
async function earned(paid: boolean) {
  const p = await project(db, "A-1", client, 400000, { start: "2026-01-01" });
  const inv = await doc(db, { type: "invoice", date: "2026-03-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 400000 }] });
  await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 300000 }] });
  await db.transaction((tx) => tx.query(`select complete_project($1, '2026-04-30')`, [p]));
  if (paid) await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });
  return p;
}

describe("financing from company capital", () => {
  it("knows what each director has kept in the company and what is the company's own", async () => {
    await earned(true);
    // the bank holds 400,000, but the supplier is owed 300,000 and the directors' shares of the 100,000 profit
    // (25 / 10 / 10 / 5 %) wait for their choice: the rest, 50,000, is the company's
    expect(await available()).toEqual([["Company", 50000]]);
    for (const c of await ids()) await keepAll(c);
    expect(await available()).toEqual([
      ["Mujahid", 25000], ["Muaz", 10000], ["Mushahid", 10000], ["Mariyam Zahir", 5000], ["Company", 50000],
    ]);
  });

  it("counts a payment received but not yet banked as the company's money", async () => {
    const p = await project(db, "U-1", client, 400000, { start: "2026-01-01" });
    const inv = await doc(db, { type: "invoice", date: "2026-03-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 400000 }] });
    await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 300000 }] });
    await db.transaction((tx) => tx.query(`select complete_project($1, '2026-04-30')`, [p]));
    // paid, but held in Undeposited Funds: the bank has nothing yet
    await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, total: 400000, apply: [{ to: inv, amount: 400000 }] });
    expect(await balance(db, "1010")).toBe(0);
    expect((await available()).find(([n]) => n === "Company")?.[1]).toBe(50000);
  });

  it("only counts shares that could be paid out today: not while the client still owes", async () => {
    await earned(false);
    expect(await available()).toEqual([["Company", 0]]);
  });

  it("puts in the amount chosen for each, moves the directors' money into the project, and the company's part shares the return", async () => {
    await earned(true);
    const [mj, mz, ms, mr] = await ids();
    for (const c of [mj, mz, ms, mr]) await keepAll(c);
    const q2 = await project(db, "Q-1", client, 300000, { start: "2026-06-01" });
    const bankBefore = await balance(db, "1010");
    const parts = await finance(q2, [[mj, 2500], [mz, 1000], [ms, 1000], [mr, 500], [null, 35000]]);
    expect(parts).toEqual([
      { contact_id: mujahid, name: "Mujahid", amount: 2500 }, expect.objectContaining({ name: "Muaz", amount: 1000 }),
      expect.objectContaining({ name: "Mushahid", amount: 1000 }), expect.objectContaining({ name: "Mariyam Zahir", amount: 500 }),
      { contact_id: null, name: "Company", amount: 35000 },
    ]);
    // no cash moved; Mujahid has 2,500 less in his director's account and is now a Capital Pool financier of Q-1;
    // the company's own 35,000 is committed to Q-1 until it is completed and paid
    expect(await balance(db, "1010")).toBe(bankBefore);
    expect(await available()).toEqual([
      ["Mujahid", 22500], ["Muaz", 9000], ["Mushahid", 9000], ["Mariyam Zahir", 4500], ["Company", 15000],
    ]);
    const src = await q<{ contact_id: string; received: string }>(db, `select contact_id, received from project_financing_v where project_id = $1 order by received desc`, [q2]);
    expect(src.map((s) => Number(s.received))).toEqual([2500, 1000, 1000, 500]);
    expect(Number((await one<{ f: string }>(db, `select company_funding($1) f`, [q2])).f)).toBe(35000);

    // on completion the financing pool's 20 % is divided over all 40,000, the company's 35,000 included
    const inv = await doc(db, { type: "invoice", date: "2026-08-01", dueDate: "2026-12-31", contact: client, project: q2, lines: [{ account: "4000", amount: 300000 }] });
    await doc(db, { type: "bill", date: "2026-07-01", contact: vendor, project: q2, lines: [{ account: "5000", amount: 200000 }] });
    void inv;
    const ret = await q<{ name: string; amount: string }>(db,
      `select c.name, s.amount from split_profit($1, 100000) s join contacts c on c.id = s.contact_id where s.component = 'financing_return' order by s.amount desc`, [q2]);
    expect(ret.map((r) => [r.name, Number(r.amount)])).toEqual([["Mujahid", 1250], ["Muaz", 500], ["Mushahid", 500], ["Mariyam Zahir", 250]]);
    // and the company's own 35,000 earns its 35/40 of the pool's 20,000 (035)
    expect(Number((await one<{ r: string }>(db, `select company_financing_return($1, 100000) r`, [q2])).r)).toBe(17500);
    expect(Number((await one<{ r: string }>(db, `select company_financing_return($1, 0) r`, [q2])).r)).toBe(0);
  });

  it("lets a member keep their principal in the company and reinvest it with their return and share", async () => {
    // Mariyam financed A-1 with 40,000; once it is completed and paid, her principal, return and share are released
    const p = await project(db, "A-1", client, 400000, { start: "2026-01-01" });
    const mariyam = await contactId(db, "Mariyam Zahir");
    await doc(db, { type: "capital_contribution", date: "2026-01-05", contact: mariyam, project: p, bank: "1010", total: 40000 });
    const inv = await doc(db, { type: "invoice", date: "2026-03-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 400000 }] });
    await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 300000 }] });
    await db.transaction((tx) => tx.query(`select complete_project($1, '2026-04-30')`, [p]));
    await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });

    const owed = async (component?: string) => Number((await one<{ o: string }>(db,
      `select coalesce(sum(outstanding), 0) o from partner_statement_v where contact_id = $1 and ($2::text is null or component = $2)`, [mariyam, component ?? null])).o);
    const everything = await owed(); // her principal, her return and her profit share
    expect(await owed("principal")).toBe(40000);
    expect(await keepAll(mariyam)).toBe(everything);
    const avail = await available();
    expect(avail.find(([n]) => n === "Mariyam Zahir")?.[1]).toBe(everything);
    // the company's money is the bank less everything owed: to members (her director's account included) and the supplier's 300,000
    const allOwed = Number((await one<{ o: string }>(db, `select sum(outstanding) o from partner_statement_v`)).o) + everything;
    expect(avail.find(([n]) => n === "Company")?.[1]).toBe(await balance(db, "1010") - allOwed - 300000);

    const q2 = await project(db, "Q-3", client, 300000, { start: "2026-06-01" });
    const parts = await finance(q2, [[mariyam, everything]]);
    expect(parts.find((x) => x.name === "Mariyam Zahir")?.amount).toBe(everything);
    // her principal on A-1 is repaid into her account, and all of it is now her money in Q-3
    const principal = await q<{ project_id: string; outstanding: string }>(db,
      `select project_id, outstanding from partner_statement_v where contact_id = $1 and component = 'principal' and outstanding <> 0`, [mariyam]);
    expect(principal.map((r) => [r.project_id, Number(r.outstanding)])).toEqual([[q2, everything]]);
  });

  it("keeps a running project's money in the project: the client's payment, its GST and its financing", async () => {
    const lender = await contact(db, "Lender", ["lender"]);
    const mushahid = await contactId(db, "Mushahid");
    const p = await project(db, "R-1", client, 1000000, { start: "2026-01-01" });
    await doc(db, { type: "capital_contribution", date: "2026-01-05", contact: mushahid, project: p, bank: "1010", total: 300000 });
    await doc(db, { type: "loan_receipt", date: "2026-01-05", contact: lender, project: p, bank: "1010", total: 200000 });
    const inv = await doc(db, { type: "invoice", date: "2026-02-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 200000, tax: "STD" }] });
    const total = Number((await one<{ t: string }>(db, `select sum(amount + tax_amount) t from transaction_lines where transaction_id = $1`, [inv])).t);
    expect(total).toBeGreaterThan(200000); // with GST
    // invoiced and not paid yet, then paid: either way none of it is the company's while the project runs
    expect(await available()).toEqual([["Company", 0]]);
    await doc(db, { type: "customer_payment", date: "2026-02-10", contact: client, bank: "1010", total, apply: [{ to: inv, amount: total }] });
    expect(await balance(db, "1010")).toBe(500000 + total);
    expect(await available()).toEqual([["Company", 0]]);
    // its costs are paid from the project's money, still none of the company's
    const bill = await doc(db, { type: "bill", date: "2026-02-15", contact: vendor, project: p, lines: [{ account: "5000", amount: 150000 }] });
    expect(await available()).toEqual([["Company", 0]]);
    await doc(db, { type: "bill_payment", date: "2026-02-20", contact: vendor, bank: "1010", total: 150000, apply: [{ to: bill, amount: 150000 }] });
    expect(await available()).toEqual([["Company", 0]]);
  });

  it("refuses more than is available, and anyone but an admin", async () => {
    await earned(true);
    await keepAll(mujahid);
    const q2 = await project(db, "Q-2", client, 300000, { start: "2026-06-01" });
    await expect(finance(q2, [[null, 50000.01]])).rejects.toThrow(/MVR 50,000.00 of its own/);
    await expect(finance(q2, [[mujahid, 25000.01]])).rejects.toThrow(/MVR 25,000.00 in their director's account/);
    await expect(finance(q2, [[mujahid, 100]], MANAGER)).rejects.toThrow(/Only an admin/);
  });
});
