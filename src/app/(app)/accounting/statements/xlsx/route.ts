import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { loadStatements } from "@/lib/statements-data";
import { ACCT_NAME, trialBalance } from "@/lib/statements";

/** The year's statements, trial balance and journal as a workbook for the accountant. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Not signed in", { status: 401 });
  const data = await loadStatements(supabase, request.nextUrl.searchParams.get("year") ?? undefined);
  const c = data.current;
  const p = data.prior;
  const cp = c.position;
  const pp = p.position;
  const NUM = '#,##0;(#,##0);"-"';

  const wb = new ExcelJS.Workbook();
  wb.creator = data.company.name;

  /** A statement: title rows, then label / this year / last year. */
  const sheet = (name: string, title: string, sub: string, rows: ([string, number, number] | [string] | [])[]) => {
    const ws = wb.addWorksheet(name);
    ws.columns = [{ width: 52 }, { width: 18 }, { width: 18 }];
    ws.addRow([data.company.name]).font = { bold: true, size: 13 };
    ws.addRow([title]).font = { bold: true, size: 12 };
    ws.addRow([sub]).font = { bold: true };
    ws.addRow(["(All Amounts in Maldivian Rufiyaa Unless Otherwise Stated)"]).font = { italic: true, size: 9 };
    if (c.toDate) ws.addRow([`Draft: figures to date; the year ends 31 December ${c.year}`]).font = { italic: true, color: { argb: "FFB45309" } };
    ws.addRow([]);
    const head = ws.addRow(["", `31 Dec ${c.year}`, `31 Dec ${p.year}`]);
    head.font = { bold: true };
    head.alignment = { horizontal: "right" };
    for (const r of rows) {
      const row = ws.addRow(r);
      if (r.length === 1) row.font = { bold: true };
      row.getCell(2).numFmt = NUM;
      row.getCell(3).numFmt = NUM;
      if (r[0] && /^(Total|Gross|Operating|Profit|Net|Cash and cash equivalents at 31)/.test(r[0])) {
        row.font = { bold: true };
        row.getCell(2).border = { top: { style: "thin" } };
        row.getCell(3).border = { top: { style: "thin" } };
      }
    }
    return ws;
  };

  const payA = cp.liabilities.payables + cp.liabilities.gst + cp.liabilities.advances;
  const payB = pp.liabilities.payables + pp.liabilities.gst + pp.liabilities.advances;
  sheet("Financial position", "Statement of Financial Position", `As at 31 December ${c.year}`, [
    ["ASSETS"],
    ["Property, plant and equipment", cp.assets.ppe, pp.assets.ppe],
    ["Work in progress", cp.assets.wip, pp.assets.wip],
    ["Trade and other receivables", cp.assets.receivables, pp.assets.receivables],
    ["Cash and cash equivalents", cp.assets.cash, pp.assets.cash],
    ["Total assets", cp.totalAssets, pp.totalAssets],
    [],
    ["EQUITY AND LIABILITIES"],
    ["Share capital", cp.equity.share, pp.equity.share],
    ["Partners' capital", cp.equity.capital, pp.equity.capital],
    ["Retained earnings", cp.equity.retained, pp.equity.retained],
    ["Total equity", cp.equity.total, pp.equity.total],
    ["Trade and other payables", payA, payB],
    ["Due to partners and investors", cp.liabilities.due, pp.liabilities.due],
    ["Bank overdraft", cp.liabilities.overdraft, pp.liabilities.overdraft],
    ["Income tax payable", cp.liabilities.tax, pp.liabilities.tax],
    ["Total liabilities", cp.totalLiabilities, pp.totalLiabilities],
    ["Total equity and liabilities", cp.equity.total + cp.totalLiabilities, pp.equity.total + pp.totalLiabilities],
  ]);
  sheet("Income", "Statement of Comprehensive Income", `For the year ended 31 December ${c.year}`, [
    ["Revenue", c.performance.revenue, p.performance.revenue],
    ["Cost of sales", -c.performance.cogs, -p.performance.cogs],
    ["Gross profit", c.performance.gross, p.performance.gross],
    ["Administrative expenses", -c.performance.admin, -p.performance.admin],
    ["Operating profit", c.performance.operating, p.performance.operating],
    ["Finance costs", -c.performance.finance, -p.performance.finance],
    ["Profit before tax", c.performance.pbt, p.performance.pbt],
    [c.taxFiled ? "Income tax expense" : "Income tax expense (estimate)", -c.performance.tax, -p.performance.tax],
    ["Profit for the year", c.performance.pat, p.performance.pat],
  ]);
  const cc = c.cashflow;
  const pc = p.cashflow;
  const merge = (a: [string, number][], b: [string, number][]) =>
    [...new Set([...a.map(([k]) => k), ...b.map(([k]) => k)])].map((k) => [k, a.find(([x]) => x === k)?.[1] ?? 0, b.find(([x]) => x === k)?.[1] ?? 0] as [string, number, number]);
  sheet("Cash flows", "Statement of Cash Flows", `For the year ended 31 December ${c.year}`, [
    ["Cash flows from operating activities"],
    ["Profit before tax", cc.pbt, pc.pbt],
    ["Depreciation", cc.depreciation, pc.depreciation],
    ["Loss / (gain) on disposal of equipment", cc.disposal, pc.disposal],
    ["Finance costs", cc.finance, pc.finance],
    ["(Increase) / decrease in work in progress", cc.dWip, pc.dWip],
    ["(Increase) / decrease in receivables", cc.dAr, pc.dAr],
    ["Increase / (decrease) in payables", cc.dPay, pc.dPay],
    ["Increase / (decrease) in GST payable", cc.dGst, pc.dGst],
    ["Income tax paid", cc.dTax, pc.dTax],
    ["Net cash from operating activities", cc.operating, pc.operating],
    ["Cash flows from investing activities"],
    ...merge(cc.investingLines, pc.investingLines),
    ["Net cash used in investing activities", cc.investing, pc.investing],
    ["Cash flows from financing activities"],
    ...merge(cc.financingLines, pc.financingLines),
    ["Net cash from / (used in) financing activities", cc.financing, pc.financing],
    ["Net increase / (decrease) in cash", cc.net, pc.net],
    ["Cash and cash equivalents at 1 January", cc.opening, pc.opening],
    ["Cash and cash equivalents at 31 December", cc.closing, pc.closing],
  ]);
  const eq = (y: typeof c) => y.equity;
  sheet("Changes in equity", "Statement of Changes in Equity", `For the year ended 31 December ${c.year}`, [
    ["Total equity at 1 January", c.opening.equity.total, p.opening.equity.total],
    ["Profit for the year", eq(c).profit, eq(p).profit],
    ["Profit shares to partners and investors", eq(c).shares, eq(p).shares],
    ["Shares issued", eq(c).shareIn, eq(p).shareIn],
    ["Capital introduced by partners", eq(c).introduced, eq(p).introduced],
    ["Profit shares kept as capital", eq(c).kept, eq(p).kept],
    ["Drawings by partners", eq(c).drawn, eq(p).drawn],
    ["Other movements", eq(c).otherCap + eq(c).opening, eq(p).otherCap + eq(p).opening],
    ["Total equity at 31 December", cp.equity.total, pp.equity.total],
  ]);

  // trial balance at the year end
  const tb = wb.addWorksheet("Trial balance");
  tb.columns = [{ width: 44 }, { width: 18 }, { width: 18 }];
  tb.addRow([data.company.name]).font = { bold: true, size: 13 };
  tb.addRow([`Trial balance at 31 December ${c.year}`]).font = { bold: true };
  tb.addRow([]);
  tb.addRow(["Account", "Debit", "Credit"]).font = { bold: true };
  const rows = trialBalance(data.journal, c.year);
  for (const r of rows) {
    const row = tb.addRow([r.name, r.balance > 0 ? r.balance : null, r.balance < 0 ? -r.balance : null]);
    row.getCell(2).numFmt = "#,##0.00";
    row.getCell(3).numFmt = "#,##0.00";
  }
  const tot = tb.addRow(["Total", rows.reduce((s, r) => s + Math.max(0, r.balance), 0), rows.reduce((s, r) => s + Math.max(0, -r.balance), 0)]);
  tot.font = { bold: true };
  tot.getCell(2).numFmt = "#,##0.00";
  tot.getCell(3).numFmt = "#,##0.00";

  // every journal line in the year
  const jn = wb.addWorksheet("Journal");
  jn.columns = [
    { header: "Date", width: 12 },
    { header: "Account", width: 32 },
    { header: "Detail", width: 36 },
    { header: "Description", width: 48 },
    { header: "Debit", width: 16 },
    { header: "Credit", width: 16 },
  ];
  jn.getRow(1).font = { bold: true };
  for (const l of data.journal.filter((x) => x.date >= c.from && x.date <= c.to)) {
    const row = jn.addRow([l.date, ACCT_NAME[l.acct], l.sub ? data.projectName(l.sub) : "", l.memo, l.amount > 0 ? l.amount : null, l.amount < 0 ? -l.amount : null]);
    row.getCell(5).numFmt = "#,##0.00";
    row.getCell(6).numFmt = "#,##0.00";
  }
  jn.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Financial statements ${c.year}.xlsx"`,
    },
  });
}
