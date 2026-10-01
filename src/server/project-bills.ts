import ExcelJS from "exceljs";
import type { Session } from "@/server/session";
import { expenseFormData } from "@/server/expense-data";
import { SHEET_COLUMNS, type Lookups, type RawRow } from "@/lib/bill-import";

/** Ids of the bills on a project: headed to it, or with a line charged to it. */
async function projectBillIds(s: Session, projectId: string) {
  const [{ data: byHead }, { data: byLine }] = await Promise.all([
    s.supabase.from("transactions").select("id").eq("type", "bill").eq("project_id", projectId).is("voided_at", null),
    s.supabase.from("transaction_lines").select("transaction_id, transactions!inner(type, voided_at)").eq("project_id", projectId)
      .eq("transactions.type", "bill").is("transactions.voided_at", null),
  ]);
  return new Set([...(byHead ?? []).map((r) => r.id as string), ...(byLine ?? []).map((r) => r.transaction_id as string)]);
}

/** What an uploaded sheet is checked against. */
export async function billLookups(s: Session, projectId: string): Promise<Lookups> {
  const [form, ids, { data: saved }, { data: lines }] = await Promise.all([
    expenseFormData(s),
    projectBillIds(s, projectId),
    s.supabase.from("transactions").select("id, contact_id, tax_invoice_no, number").eq("type", "bill").is("voided_at", null).not("tax_invoice_no", "is", null),
    s.supabase.from("transaction_lines").select("account_id, amount, description, transactions!inner(contact_id, date, number, type, voided_at, project_id)")
      .eq("transactions.type", "bill").is("transactions.voided_at", null).eq("transactions.project_id", projectId),
  ]);
  return {
    vendors: form.vendors.map((v) => ({ id: v.id, name: v.name, tin: v.tin, gst_registered: v.gst_registered })),
    accounts: form.accounts.map((a) => ({ id: a.id, code: a.code, name: a.name })),
    projectBillIds: ids,
    saved: (saved ?? []).map((b) => ({ id: b.id, contact_id: b.contact_id as string, tax_invoice_no: b.tax_invoice_no as string, number: b.number })),
    savedLines: ((lines ?? []) as unknown as { account_id: string; amount: number; description: string | null; transactions: { contact_id: string; date: string; number: string | null } }[])
      .map((l) => ({ contact_id: l.transactions.contact_id, date: l.transactions.date, account_id: l.account_id, amount: String(l.amount), description: l.description, number: l.transactions.number })),
  };
}

type BillLine = { transaction_id: string; description: string | null; amount: number; tax_amount: number; gst_claimable: boolean; accounts: { code: string } | null;
  transactions: { date: string; due_date: string | null; supplier_tin: string | null; tax_invoice_no: string | null; tax_invoice_date: string | null; reference: string | null; contacts: { name: string } | null } };

/** The workbook: the Bills sheet (blank, or this project's bills), how to fill it, and the accounts and vendors to pick from. */
export async function billWorkbook(s: Session, projectId: string, withBills: boolean) {
  const [form, { data: project }] = await Promise.all([
    expenseFormData(s),
    s.supabase.from("projects").select("code, name").eq("id", projectId).maybeSingle(),
  ]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bills");
  ws.columns = SHEET_COLUMNS.map(([key, header]) => ({ key, header, width: key === "description" ? 36 : key === "vendor" ? 26 : 18 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (withBills) {
    const ids = [...(await projectBillIds(s, projectId))];
    if (ids.length) {
      const { data } = await s.supabase.from("transaction_lines")
        .select("transaction_id, description, amount, tax_amount, gst_claimable, accounts(code), transactions!inner(date, due_date, supplier_tin, tax_invoice_no, tax_invoice_date, reference, contacts(name))")
        .in("transaction_id", ids).order("line_no");
      const lines = ((data ?? []) as unknown as BillLine[]).sort((a, b) => a.transactions.date.localeCompare(b.transactions.date));
      for (const l of lines) {
        ws.addRow({
          id: l.transaction_id, date: l.transactions.date, due_date: l.transactions.due_date ?? "", vendor: l.transactions.contacts?.name ?? "",
          vendor_tin: l.transactions.supplier_tin ?? "", invoice_no: l.transactions.tax_invoice_no ?? "", invoice_date: l.transactions.tax_invoice_date ?? "",
          description: l.description ?? "", account: l.accounts?.code ?? "", amount: Number(l.amount), gst: Number(l.tax_amount),
          claimable: l.gst_claimable ? "Y" : "N", reference: l.transactions.reference ?? "",
        });
      }
    }
  }
  for (const k of ["amount", "gst"]) ws.getColumn(k).numFmt = "#,##0.00";

  const help = wb.addWorksheet("How to fill");
  help.columns = [{ width: 110 }];
  for (const line of [
    `Bills for ${project?.code ?? ""} ${project?.name ?? ""}`,
    "",
    "One row per bill line. Rows with the same vendor and supplier invoice no. become one bill with several lines.",
    "ID: leave blank for new bills. Rows with an ID were downloaded from the app and are already saved — they are skipped on upload.",
    "Dates: YYYY-MM-DD (2026-09-01) or day/month/year (1/9/2026).",
    "Vendor: the name as in Vendors (see the Vendors sheet), or a new name — new vendors are added and marked for review.",
    "Account code: from the Accounts sheet (5000 Materials, 5010 Subcontractors …).",
    "Amount before GST and GST: numbers. GST is the supplier's own figure on their invoice.",
    "GST claimable: Y only with the vendor's TIN, the supplier invoice no., and a GST-registered vendor; otherwise N (the GST becomes cost).",
    "A bill already saved (same vendor and invoice no.) is recognised and skipped, so you can upload the same sheet again after adding rows.",
  ]) help.addRow([line]);
  help.getRow(1).font = { bold: true, size: 13 };

  const acc = wb.addWorksheet("Accounts");
  acc.columns = [{ header: "Code", key: "code", width: 10 }, { header: "Account", key: "name", width: 40 }];
  acc.getRow(1).font = { bold: true };
  for (const a of form.accounts) acc.addRow({ code: a.code, name: a.name });

  const ven = wb.addWorksheet("Vendors");
  ven.columns = [{ header: "Vendor", key: "name", width: 36 }, { header: "TIN", key: "tin", width: 20 }, { header: "GST registered", key: "gst", width: 16 }];
  ven.getRow(1).font = { bold: true };
  for (const v of form.vendors) ven.addRow({ name: v.name, tin: v.tin ?? "", gst: v.gst_registered ? "Yes" : "No" });

  return { buffer: await wb.xlsx.writeBuffer(), code: project?.code ?? "project" };
}

/** A cell as the text a person typed: dates as YYYY-MM-DD, numbers to 2 decimals at most. */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue); // a formula
    if ("text" in v) return String(v.text);                                                      // a hyperlink
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
  }
  return String(v).trim();
}

/** Read the Bills sheet of an uploaded workbook (or a CSV) into rows. */
export async function readBillSheet(file: File): Promise<RawRow[]> {
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  let ws: ExcelJS.Worksheet | undefined;
  if (/\.csv$/i.test(file.name)) {
    const { Readable } = await import("node:stream");
    ws = await wb.csv.read(Readable.from(buf));
  } else {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    ws = wb.getWorksheet("Bills") ?? wb.worksheets[0];
  }
  if (!ws) return [];
  // columns by their header, so a sheet with columns moved still reads
  // row values are a sparse array (index 0 and empty cells are holes)
  const header = Array.from(ws.getRow(1).values as ExcelJS.CellValue[], (v) => cellText(v ?? null).toLowerCase());
  const colOf = new Map<string, number>();
  for (const [key, label] of SHEET_COLUMNS) {
    const i = header.findIndex((h) => h === label.toLowerCase() || h.startsWith(label.toLowerCase().split(" (")[0]));
    if (i > 0) colOf.set(key, i);
  }
  const rows: RawRow[] = [];
  ws.eachRow({ includeEmpty: false }, (r, n) => {
    if (n === 1) return;
    const raw: RawRow = { row: n };
    for (const [key] of SHEET_COLUMNS) { const c = colOf.get(key); if (c) raw[key] = cellText(r.getCell(c).value); }
    if (Object.entries(raw).some(([k, v]) => k !== "row" && v)) rows.push(raw);
  });
  return rows;
}
