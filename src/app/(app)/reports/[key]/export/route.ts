import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/server/session";
import { reportCsv, type Report } from "@/lib/report-model";
import { cellText } from "@/components/reports/report-table";
import { runReport } from "@/server/reports/run";
import { yearEndPack } from "@/server/reports/pack";

const NUM = '#,##0.00;(#,##0.00);"-"';

/** Add one report to a workbook as its own sheet: title rows, header, then the rows (money as numbers). */
function addSheet(wb: ExcelJS.Workbook, r: Report, company: string) {
  const ws = wb.addWorksheet(r.title.replace(/[\\/*?:[\]]/g, "").slice(0, 31));
  ws.addRow([company]).font = { bold: true, size: 13 };
  ws.addRow([r.title]).font = { bold: true, size: 12 };
  if (r.subtitle) ws.addRow([r.subtitle]).font = { italic: true };
  ws.addRow(["All amounts in Maldivian Rufiyaa"]).font = { italic: true, size: 9 };
  ws.addRow([]);
  const head = ws.addRow(r.columns.map((c) => c.label));
  head.font = { bold: true };
  ws.columns = r.columns.map((c, i) => ({ width: i === 0 ? 44 : c.kind === "money" ? 16 : 14 }));
  for (const row of r.rows) {
    const x = ws.addRow(r.columns.map((c) => {
      const v = row.cells[c.key] ?? null;
      if (typeof v === "bigint") return Number(v) / 100;
      if (c.kind === "pct" || c.kind === "num") return typeof v === "number" ? v : v === null ? null : Number(v);
      return cellText(c, v);
    }));
    r.columns.forEach((c, i) => { if (c.kind === "money") x.getCell(i + 1).numFmt = NUM; });
    if (row.style === "section" || row.style === "total" || row.style === "subtotal") x.font = { bold: true };
    if (row.style === "indent") x.getCell(1).alignment = { indent: 1 };
  }
  for (const n of r.notes ?? []) ws.addRow([n]).font = { italic: true, size: 9 };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const s = await getSession();
  if (!s) return new NextResponse("Not signed in", { status: 401 });
  const { key } = await params;
  const q = Object.fromEntries(req.nextUrl.searchParams.entries());
  const format = q.format === "xlsx" ? "xlsx" : "csv";
  const { data: co } = await s.supabase.from("company").select("legal_name, trade_name").eq("id", true).maybeSingle();
  const company = co?.trade_name || co?.legal_name || "Spruce & Co";
  const book = s.book === "sandbox" ? "-TEST" : "";

  let reports: Report[];
  let name: string;
  if (key === "year-end") {
    const pack = await yearEndPack(s, q);
    reports = pack.reports;
    name = `year-end-pack${book}`;
  } else {
    const ran = await runReport(s, key, q);
    if ("error" in ran) return new NextResponse(ran.error, { status: ran.status });
    reports = [ran.report];
    name = `${key}-${ran.params.range.from}-to-${ran.params.range.to}${book}`;
  }
  if (format === "csv") {
    const body = reports.map((r) => `${r.title}${r.subtitle ? ` — ${r.subtitle}` : ""}\n${reportCsv(r)}`).join("\n");
    return new NextResponse(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` } });
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = company;
  for (const r of reports) addSheet(wb, r, company);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"` },
  });
}
