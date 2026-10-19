import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";
import { contact, contactId, doc, project } from "./books";

/** Reports and statements (migration 026), on one small set of books where every figure is known. */
let db: PGlite;
let p: string;

beforeEach(async () => {
  db = await freshDb();
  const client = await contact(db, "Client", ["customer"]);
  const vendor = await contact(db, "Supplier", ["vendor"]);
  const mujahid = await contactId(db, "Mujahid");
  p = await project(db, "R-1", client, 400000);
  // opening balances: 20,000 in the bank, owed 5,000 to the supplier
  await doc(db, { type: "opening_balance", date: "2025-12-31", lines: [{ account: "1010", debit: 20000 }, { account: "2000", credit: 5000, contact: vendor }] });
  await doc(db, { type: "capital_contribution", date: "2026-01-05", contact: mujahid, project: p, bank: "1010", total: 200000 });
  const inv = await doc(db, { type: "invoice", date: "2026-02-01", dueDate: "2026-03-01", contact: client, project: p, lines: [{ account: "4000", amount: 400000 }] });
  await doc(db, { type: "customer_payment", date: "2026-02-20", contact: client, bank: "1010", total: 300000, apply: [{ to: inv, amount: 300000 }] });
  const bill = await doc(db, { type: "bill", date: "2026-02-05", contact: vendor, project: p, lines: [{ account: "5000", amount: 250000 }] });
  await doc(db, { type: "bill_payment", date: "2026-02-25", contact: vendor, bank: "1010", total: 100000, apply: [{ to: bill, amount: 100000 }] });
  await doc(db, { type: "journal", date: "2026-03-01", lines: [{ account: "1010", debit: 50000 }, { account: "3000", credit: 50000 }] });
});
afterEach(async () => { await assertHealthy(db); });

const n = (rows: Record<string, unknown>[], key: string, value: string, field: string) => Number(rows.find((r) => r[key] === value)?.[field] ?? 0);

describe("trial balance", () => {
  it("opening + movement = closing per account, and the whole book nets to zero", async () => {
    const rows = await q<{ code: string; opening: string; debit: string; credit: string; closing: string }>(db, `select * from report_tb('2026-01-01', '2026-12-31')`);
    expect(n(rows, "code", "1010", "opening")).toBe(20000);
    expect(n(rows, "code", "1010", "closing")).toBe(470000);
    expect(n(rows, "code", "2000", "opening")).toBe(-5000);
    for (const r of rows) expect(Number(r.opening) + Number(r.debit) - Number(r.credit)).toBeCloseTo(Number(r.closing), 2);
    expect(rows.reduce((t, r) => t + Number(r.closing), 0)).toBeCloseTo(0, 2);
    const proj = await q<{ code: string; closing: string }>(db, `select code, closing from report_tb('2026-01-01', '2026-12-31', $1)`, [p]);
    expect(n(proj, "code", "4000", "closing")).toBe(-400000);
  });
});

describe("statement of cash flows", () => {
  it("indirect method: profit, working capital and financing add up to the change in cash", async () => {
    const rows = await q<{ section: string; label: string; amount: string }>(db, `select * from cash_flow('2026-01-01', '2026-12-31') order by sort, label`);
    const get = (label: string) => n(rows, "label", label, "amount");
    expect(get("Cash at the start of the period")).toBe(20000);
    expect(get("Profit for the period")).toBe(150000);
    expect(get("Change in Accounts Receivable")).toBe(-100000);
    expect(get("Change in Accounts Payable")).toBe(150000);
    expect(get("Capital Pool Loans")).toBe(200000);
    expect(get("Share Capital")).toBe(50000);
    expect(get("Cash at the end of the period")).toBe(470000);
    const flows = rows.filter((r) => ["operating", "investing", "financing", "opening_balances"].includes(r.section)).reduce((t, r) => t + Number(r.amount), 0);
    expect(20000 + flows).toBe(470000);
  });

  it("opening balances entered inside the range are shown on their own", async () => {
    const rows = await q<{ section: string; amount: string }>(db, `select * from cash_flow('2025-12-01', '2026-12-31')`);
    expect(n(rows, "section", "cash_start", "amount")).toBe(0);
    expect(n(rows, "section", "opening_balances", "amount")).toBe(20000);
    expect(n(rows, "section", "cash_end", "amount")).toBe(470000);
  });

  it("direct summary: cash in and out by kind", async () => {
    const rows = await q<{ kind: string; cash_in: string; cash_out: string }>(db, `select * from cash_summary('2026-01-01', '2026-12-31')`);
    expect(rows.map((r) => [r.kind, Number(r.cash_in), Number(r.cash_out)]).sort()).toEqual([
      ["bill_payment", 0, 100000], ["capital_contribution", 200000, 0], ["customer_payment", 300000, 0], ["journal", 50000, 0]]);
  });
});

describe("statement of changes in equity", () => {
  it("opening + profit + share capital = closing, which equals net assets", async () => {
    const rows = await q<{ label: string; share_capital: string; retained_earnings: string; other_equity: string; total: string }>(db,
      `select * from equity_changes('2026-01-01', '2026-12-31') order by sort`);
    expect(n(rows, "label", "Balance at the start", "other_equity")).toBe(15000);
    expect(n(rows, "label", "Profit for the period", "retained_earnings")).toBe(150000);
    expect(n(rows, "label", "Share capital issued", "share_capital")).toBe(50000);
    expect(n(rows, "label", "Balance at the end", "total")).toBe(215000);
    const na = await one<{ v: string }>(db, `select sum(closing)::text v from report_tb('2026-01-01', '2026-12-31') where type in ('asset', 'liability')`);
    expect(Number(na.v)).toBe(215000);
  });
});

describe("profit and loss by project", () => {
  it("groups income and costs by project", async () => {
    const rows = await q<{ dim_id: string; amount: string }>(db, `select dim_id, sum(amount)::text amount from report_by('2026-01-01', '2026-12-31', 'project') group by 1`);
    expect(Number(rows.find((r) => r.dim_id === p)?.amount)).toBe(150000);
  });

  it("the fiscal year starts in the month set", async () => {
    expect((await one<{ d: string }>(db, `select fiscal_year_start('2026-09-30')::text d`)).d).toBe("2026-01-01");
    await db.query(`update settings set fiscal_year_start_month = 7`);
    expect((await one<{ d: string }>(db, `select fiscal_year_start('2026-03-15')::text d`)).d).toBe("2025-07-01");
    expect((await one<{ d: string }>(db, `select fiscal_year_start('2026-07-01')::text d`)).d).toBe("2026-07-01");
  });
});
