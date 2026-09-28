import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one, q } from "./harness";
import { balance, contact, contactId, doc, journal, project } from "./books";

let db: PGlite;
let client: string;
let vendor: string;
let lender: string;
let mujahid: string;
let muaz: string;
let mushahid: string;
let mariyam: string;

beforeEach(async () => {
  db = await freshDb();
  client = await contact(db, "Client", ["customer"]);
  vendor = await contact(db, "Supplier", ["vendor"]);
  lender = await contact(db, "External Lender", ["lender"]);
  [mujahid, muaz, mushahid, mariyam] = await Promise.all(["Mujahid", "Muaz", "Mushahid", "Mariyam Zahir"].map((n) => contactId(db, n)));
});

/** A project with revenue and costs giving `profit`, financed as given. */
async function setup(profit: number, financing: [string, number][], opts: { revenue?: number } = {}) {
  const revenue = opts.revenue ?? profit + 300000;
  const p = await project(db, `F-${Math.round(Math.random() * 1e6)}`, client, revenue);
  for (const [who, amount] of financing) {
    await doc(db, { type: who === lender ? "loan_receipt" : "capital_contribution", date: "2026-01-05", contact: who, project: p, bank: "1010", total: amount });
  }
  const inv = await doc(db, { type: "invoice", date: "2026-03-01", dueDate: "2026-12-31", contact: client, project: p, lines: [{ account: "4000", amount: revenue }] });
  await doc(db, { type: "bill", date: "2026-02-01", contact: vendor, project: p, lines: [{ account: "5000", amount: revenue - profit }] });
  return { p, inv };
}
const complete = (p: string, date = "2026-04-30") =>
  db.transaction(async (tx) => (await one<{ id: string }>(tx, `select complete_project($1, $2) id`, [p, date])).id);
const lines = async (dist: string) => {
  const rows = await q<{ name: string; component: string; amount: string }>(db,
    `select c.name, dl.component, dl.amount from distribution_lines dl join contacts c on c.id = dl.contact_id
     where dl.distribution_id = $1 order by c.name, dl.component`, [dist]);
  return rows.map((r) => [r.name, r.component, Number(r.amount)]);
};
const pay = (p: string, inv: string, amount: number, date = "2026-05-10") =>
  doc(db, { type: "customer_payment", date, contact: client, bank: "1010", total: amount, apply: [{ to: inv, amount }] });

describe("the profit split (§5)", () => {
  it("matches the worked example to the laari, and posts Dr Finance Cost 100,000 + Profit Share 250,000", async () => {
    const { p } = await setup(500000, [[lender, 400000], [mujahid, 300000], [muaz, 200000], [mushahid, 100000]]);
    const dist = await complete(p);
    expect(await lines(dist)).toEqual([
      ["External Lender", "financing_return", 40000],
      ["Mariyam Zahir", "profit_share", 25000],
      ["Muaz", "financing_return", 20000], ["Muaz", "profit_share", 50000],
      ["Mujahid", "financing_return", 30000], ["Mujahid", "profit_share", 125000],
      ["Mushahid", "financing_return", 10000], ["Mushahid", "profit_share", 50000],
    ]);
    const txn = (await one<{ id: string }>(db, `select journal_transaction_id id from distributions where id = $1`, [dist])).id;
    const j = await journal(db, txn);
    expect(j.find((r) => r[0] === "6300")).toEqual(["6300", 100000, 0]);
    expect(j.find((r) => r[0] === "6310")).toEqual(["6310", 250000, 0]);
    expect(j.reduce((s, r) => s + r[1], 0)).toBe(350000);
    expect(j.reduce((s, r) => s + r[2], 0)).toBe(350000);
    // the company's 150,000 is not posted anywhere: it stays as profit
    expect(await balance(db, "2800")).toBe(-100000);
    expect(await balance(db, "2900")).toBe(-250000);
  });

  it("keeps principal, financing return and profit share in three separate accounts per person", async () => {
    const { p } = await setup(500000, [[lender, 400000], [mujahid, 300000], [muaz, 200000], [mushahid, 100000]]);
    await complete(p);
    const st = await q<{ component: string; outstanding: string }>(db,
      `select component, outstanding from partner_statement_v where contact_id = $1 and project_id = $2 order by component`, [mujahid, p]);
    expect(st.map((r) => [r.component, Number(r.outstanding)])).toEqual([["financing_return", 30000], ["principal", 300000], ["profit_share", 125000]]);
  });

  it("zero profit and a loss share nothing (P2)", async () => {
    const a = await setup(0, [[mujahid, 100000]]);
    expect(await lines(await complete(a.p))).toEqual([]);
    const b = await setup(-50000, [[mujahid, 100000]]);
    const dist = await complete(b.p);
    expect(await lines(dist)).toEqual([]);
    expect((await one<{ t: string | null }>(db, `select journal_transaction_id t from distributions where id = $1`, [dist])).t).toBeNull();
  });

  it("a single financier takes the whole pool; external-only financing goes to the lender", async () => {
    const a = await setup(100000, [[muaz, 50000]]);
    expect((await lines(await complete(a.p))).filter((l) => l[1] === "financing_return")).toEqual([["Muaz", "financing_return", 20000]]);
    const b = await setup(100000, [[lender, 80000]]);
    expect((await lines(await complete(b.p))).filter((l) => l[1] === "financing_return")).toEqual([["External Lender", "financing_return", 20000]]);
  });

  it("with no financing the pool stays with the company; fixed shares still apply", async () => {
    const { p } = await setup(100000, []);
    expect(await lines(await complete(p))).toEqual([
      ["Mariyam Zahir", "profit_share", 5000], ["Muaz", "profit_share", 10000], ["Mujahid", "profit_share", 25000], ["Mushahid", "profit_share", 10000]]);
  });

  it("rounds down in laari; every remainder stays with the company", async () => {
    const { p } = await setup(100000.07, [[mujahid, 30000], [muaz, 30000], [mushahid, 30000]]);
    const l = await lines(await complete(p));
    // pool = floor(10,000,007 × 20%) = 2,000,001 laari; a third each = 666,667 laari
    expect(l.filter((x) => x[1] === "financing_return").map((x) => x[2])).toEqual([6666.67, 6666.67, 6666.67]);
    // Mujahid 25% of 10,000,007 laari = 2,500,001.75 → 25,000.01
    expect(l.find((x) => x[0] === "Mujahid" && x[1] === "profit_share")?.[2]).toBe(25000.01);
    const paid = l.reduce((s, x) => s + Number(x[2]), 0);
    expect(Math.round((100000.07 * 0.7 - paid) * 100) / 100).toBeLessThan(0.05);
  });

  it("posts fixed shares to Dividends when that is the setting (P7)", async () => {
    await db.query(`update settings set profit_share_debit = 'dividends'`);
    const { p } = await setup(100000, []);
    const dist = await complete(p);
    const txn = (await one<{ id: string }>(db, `select journal_transaction_id id from distributions where id = $1`, [dist])).id;
    expect((await journal(db, txn)).find((r) => r[0] === "3200")).toEqual(["3200", 50000, 0]);
  });

  it("a scheme must total 100%, and a project keeps the scheme in force when it started (P6)", async () => {
    await expect(db.transaction(async (tx) => {
      const s = (await one<{ id: string }>(tx, `insert into profit_schemes (name, effective_from) values ('Bad', '2027-01-01') returning id`)).id;
      await tx.query(`insert into scheme_allocations (scheme_id, party_type, percent) values ($1, 'company', 90)`, [s]);
    })).rejects.toThrow(/total 100/);
    await db.transaction(async (tx) => {
      const s = (await one<{ id: string }>(tx, `insert into profit_schemes (name, effective_from) values ('2027', '2027-01-01') returning id`)).id;
      await tx.query(`insert into scheme_allocations (scheme_id, party_type, percent) values ($1, 'company', 50), ($1, 'financing_pool', 50)`, [s]);
    });
    const { p } = await setup(100000, []);
    const r = await one<{ name: string }>(db, `select s.name from projects p join profit_schemes s on s.id = p.scheme_id where p.id = $1`, [p]);
    expect(r.name).toBe("Current scheme");
  });
});

describe("payouts and bad debts (§6)", () => {
  it("blocks every payout while the client owes anything, and says how much", async () => {
    const { p, inv } = await setup(500000, [[mujahid, 300000]]);
    await complete(p);
    await pay(p, inv, 500000);
    const out = (component: string, amount: number) => doc(db, { type: "payout", date: "2026-05-20", contact: mujahid, project: p, bank: "1010",
      lines: [{ component: component as "principal", amount }] });
    await expect(out("principal", 300000)).rejects.toThrow(/client still owes MVR 300,000.00/);
    const st = await one<{ blocked: boolean; reason: string }>(db, `select * from payout_status($1)`, [p]);
    expect(st.blocked).toBe(true);
    await pay(p, inv, 300000, "2026-05-15");
    const payout = await doc(db, { type: "payout", date: "2026-05-20", contact: mujahid, project: p, bank: "1010", lines: [
      { component: "principal", amount: 300000 }, { component: "financing_return", amount: 20000 }, { component: "profit_share", amount: 125000 }] });
    const j = await journal(db, payout);
    expect(j.find((r) => r[0] === "1010")).toEqual(["1010", 0, 445000]);
    expect(j.filter((r) => r[1] > 0).map((r) => r[1]).sort((a, b) => a - b)).toEqual([20000, 125000, 300000]);
    // never more than is owed
    await expect(out("profit_share", 1)).rejects.toThrow(/more than the MVR 0.00 owed/);
  });

  it("a bad debt reduces profit, the split adjusts proportionally, and payouts are released", async () => {
    const { p, inv } = await setup(500000, [[lender, 400000], [mujahid, 300000], [muaz, 200000], [mushahid, 100000]]);
    const base = await complete(p);
    await pay(p, inv, 700000);
    // write off the last 100,000: profit falls to 400,000 (80%)
    await doc(db, { type: "bad_debt", date: "2026-07-01", contact: client, total: 100000, apply: [{ to: inv, amount: 100000 }] });
    const adj = await one<{ id: string; reason: string; adjusts: string }>(db,
      `select id, reason, adjusts_distribution_id adjusts from distributions where project_id = $1 and reason <> 'completion'`, [p]);
    expect([adj.reason, adj.adjusts]).toEqual(["bad_debt", base]);
    expect(await lines(adj.id)).toEqual([
      ["External Lender", "financing_return", -8000],
      ["Mariyam Zahir", "profit_share", -5000],
      ["Muaz", "financing_return", -4000], ["Muaz", "profit_share", -10000],
      ["Mujahid", "financing_return", -6000], ["Mujahid", "profit_share", -25000],
      ["Mushahid", "financing_return", -2000], ["Mushahid", "profit_share", -10000],
    ]);
    // the original entry is untouched; the net owed is the smaller split
    expect(await balance(db, "2800")).toBe(-80000);
    expect(await balance(db, "2900")).toBe(-200000);
    const released = await one<{ blocked: boolean }>(db, `select * from payout_status($1)`, [p]);
    expect(released.blocked).toBe(false);
  });

  it("a cost posted after completion adjusts the split and flags the project for review", async () => {
    const { p } = await setup(100000, []);
    await complete(p);
    await doc(db, { type: "bill", date: "2026-06-01", contact: vendor, project: p, lines: [{ account: "5010", amount: 20000 }] });
    const r = await one<{ reason: string; flag: string }>(db,
      `select d.reason, p.review_flag flag from distributions d join projects p on p.id = d.project_id where d.project_id = $1 and d.reason <> 'completion'`, [p]);
    expect(r.reason).toBe("late_entry");
    expect(r.flag).toMatch(/after completion/);
    expect(await balance(db, "2900", { project: p })).toBe(-40000);
  });
});
