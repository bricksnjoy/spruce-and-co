import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";
import { balance, contact, contactId, doc, project } from "./books";

/** Financing a project from the Capital Pool: members' untaken money and the company's (migration 030). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;
const available = () => as(ADMIN, () => q<{ name: string; available: string }>(db, `select name, available from company_capital_available()`))
  .then((r) => r.map((x) => [x.name, Number(x.available)]));
const finance = (p: string, amount: number) => as(ADMIN, async () =>
  (await one<{ r: { name: string; amount: number }[] }>(db, `select rpc_finance_from_company_capital($1, '2026-06-01', $2, $3) r`, [p, amount, await acct("1010")])).r);

let client: string, vendor: string, mujahid: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Manager', 'manager')`, [ADMIN, MANAGER]);
  client = await contact(db, "Client", ["customer"]);
  vendor = await contact(db, "Supplier", ["vendor"]);
  mujahid = await contactId(db, "Mujahid");
});
afterEach(async () => { await assertHealthy(db); });

/** A completed project with profit 100,000, its shares owed to the directors; paid in full by the client when `paid`. */
async function earned(paid: boolean) {
  const p = await project(db, "A-1", client, 400000, { start: "2026-01-01" });
  const inv = await doc(db, { type: "invoice", date: "2026-03-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: 400000 }] });
  await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 300000 }] });
  await db.transaction((tx) => tx.query(`select complete_project($1, '2026-04-30')`, [p]));
  if (paid) await doc(db, { type: "customer_payment", date: "2026-05-10", contact: client, bank: "1010", total: 400000, apply: [{ to: inv, amount: 400000 }] });
  return p;
}

describe("financing from company capital", () => {
  it("knows what each director has left in the company and what is the company's own", async () => {
    await earned(true);
    // shares of 100,000 profit owed (25 / 10 / 10 / 5 %); the bank holds 400,000; the rest is the company's
    expect(await available()).toEqual([
      ["Mujahid", 25000], ["Muaz", 10000], ["Mushahid", 10000], ["Mariyam Zahir", 5000], ["Company", 350000],
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
    expect((await available()).find(([n]) => n === "Company")?.[1]).toBe(350000);
  });

  it("only counts shares that could be paid out today: not while the client still owes", async () => {
    await earned(false);
    expect(await available()).toEqual([["Company", 0]]);
  });

  it("splits the financing by what each has, moves the directors' shares into the project, and the company's part shares the return", async () => {
    await earned(true);
    const q2 = await project(db, "Q-1", client, 300000, { start: "2026-06-01" });
    const bankBefore = await balance(db, "1010");
    const parts = await finance(q2, 40000); // a tenth of the 400,000 available
    expect(parts).toEqual([
      { contact_id: mujahid, name: "Mujahid", amount: 2500 }, expect.objectContaining({ name: "Muaz", amount: 1000 }),
      expect.objectContaining({ name: "Mushahid", amount: 1000 }), expect.objectContaining({ name: "Mariyam Zahir", amount: 500 }),
      { contact_id: null, name: "Company", amount: 35000 },
    ]);
    // no cash moved; Mujahid is owed 2,500 less in profit share and is now a Capital Pool financier of Q-1
    expect(await balance(db, "1010")).toBe(bankBefore);
    expect(await available()).toEqual([
      ["Mujahid", 22500], ["Muaz", 9000], ["Mushahid", 9000], ["Mariyam Zahir", 4500], ["Company", 355000],
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

  it("takes a member's returns and profit shares, never their principal, which stays theirs to be repaid", async () => {
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
    const earnedBack = (await owed()) - 40000; // her return and her profit share
    expect(await owed("principal")).toBe(40000);
    expect(earnedBack).toBeGreaterThan(0);
    const avail = await available();
    expect(avail.find(([n]) => n === "Mariyam Zahir")?.[1]).toBe(earnedBack);
    // the company's money is the bank less everything released to members, her principal included
    const allOwed = Number((await one<{ o: string }>(db, `select sum(outstanding) o from partner_statement_v`)).o);
    expect(avail.find(([n]) => n === "Company")?.[1]).toBe(await balance(db, "1010") - allOwed);

    const q2 = await project(db, "Q-3", client, 300000, { start: "2026-06-01" });
    const all = avail.reduce((t, [, v]) => t + Number(v), 0);
    const parts = await finance(q2, all); // everything available: each puts in all they have
    expect(parts.find((x) => x.name === "Mariyam Zahir")?.amount).toBe(earnedBack);
    // her principal on A-1 is untouched, still to be repaid; her return and share are now her money in Q-3
    const principal = await q<{ project_id: string; outstanding: string }>(db,
      `select project_id, outstanding from partner_statement_v where contact_id = $1 and component = 'principal' and outstanding <> 0 order by project_id = $2`, [mariyam, q2]);
    expect(principal.map((r) => [r.project_id, Number(r.outstanding)])).toEqual([[p, 40000], [q2, earnedBack]]);
  });

  it("refuses more than is available, and anyone but an admin", async () => {
    await earned(true);
    const q2 = await project(db, "Q-2", client, 300000, { start: "2026-06-01" });
    await expect(finance(q2, 400000.01)).rejects.toThrow(/available is MVR 400,000.00/);
    await expect(as(MANAGER, async () => db.query(`select rpc_finance_from_company_capital($1, '2026-06-01', 100, $2)`, [q2, await acct("1010")])))
      .rejects.toThrow(/Only an admin/);
  });
});
