import { describe, expect, it } from "vitest";
import { balanceSheet, profitLoss, reportCsv, rollup, type TbRow } from "@/lib/report-model";

const tb = (code: string, type: TbRow["type"], subtype: string | null, opening: number, debit: number, credit: number, parent: string | null = null): TbRow => ({
  account_id: `a${code}`, code, name: `Acct ${code}`, type, subtype, parent_id: parent, opening, debit, credit, closing: opening + debit - credit,
});

// from the start of the year: brought forward 10,000 profit (in P&L openings), this year 400,000 revenue, 250,000 cost, 20,000 rent
const rows: TbRow[] = [
  tb("1010", "asset", "bank", 60000, 330000, 100000),
  tb("1100", "asset", "ar", 0, 400000, 300000),
  tb("1500", "asset", "fixed_asset", 30000, 0, 0),
  tb("2000", "liability", "ap", -20000, 100000, 250000),
  tb("2700", "liability", "capital_pool_loans", 0, 0, 0),
  tb("2701", "liability", null, 0, 0, 50000, "a2700"),
  tb("3000", "equity", "share_capital", -60000, 0, 0),
  tb("3200", "equity", "dividends", 0, 0, 0),
  tb("4000", "income", "contract_revenue", -30000, 0, 400000),
  tb("5000", "cogs", "materials", 20000, 250000, 0),
  tb("6100", "expense", "rent", 0, 20000, 0),
];
const parents = new Map([["a2700", { code: "2700", name: "Capital Pool Loans" }]]);
const accts = rollup(rows, parents);
const val = (r: ReturnType<typeof profitLoss>, label: string, key = "cur") => r.find((x) => x.cells.label === label)?.cells[key];

describe("statements from a trial balance", () => {
  it("folds per-person sub-accounts into their parent", () => {
    const loan = accts.find((a) => a.code === "2700")!;
    expect(loan.closing).toBe(-5000000n);
    expect(accts.some((a) => a.code === "2701")).toBe(false);
  });

  it("profit or loss: revenue, cost of sales, gross profit, expenses, profit and % of revenue", () => {
    const pl = profitLoss([{ key: "cur", label: "2026", accts }]);
    expect(val(pl, "Total revenue")).toBe(40000000n);
    expect(val(pl, "Gross profit")).toBe(15000000n);
    expect(val(pl, "Total expenses")).toBe(2000000n);
    expect(val(pl, "Profit for the period")).toBe(13000000n);
    expect(val(pl, "Profit for the period", "pct")).toBe(32.5);
  });

  it("balance sheet balances, with profit brought forward and this year's profit apart", () => {
    const bs = balanceSheet([{ key: "cur", label: "30 Sep 2026", accts }]);
    expect(val(bs, "Total assets")).toBe(42000000n);
    expect(val(bs, "Total liabilities")).toBe(22000000n);
    expect(val(bs, "Retained earnings brought forward")).toBe(1000000n);
    expect(val(bs, "Profit for the year to date")).toBe(13000000n);
    expect(val(bs, "Share capital")).toBe(6000000n);
    expect(val(bs, "Total equity")).toBe(20000000n);
    expect(val(bs, "Total liabilities and equity")).toBe(val(bs, "Total assets"));
  });

  it("CSV keeps money exact and quotes where needed", () => {
    const csv = reportCsv({ title: "T", columns: [{ key: "label", label: "Account" }, { key: "v", label: "Amount", kind: "money" }],
      rows: [{ cells: { label: "Rent, office", v: -123456n } }, { cells: { label: "Say \"hi\"", v: 5n } }] });
    expect(csv).toBe('Account,Amount\n"Rent, office",-1234.56\n"Say ""hi""",0.05\n');
  });
});
