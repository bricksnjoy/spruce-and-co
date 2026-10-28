import ExcelJS from "exceljs";
import type { Session } from "@/server/session";
import { expenseFormData, type ExpenseFormData } from "@/server/expense-data";
import { CATEGORY_CODES, HEADER_ALIASES, SHEET_COLUMNS, type Lookups, type RawRow } from "@/lib/bill-import";

/** Ids of the bills on a project: headed to it, or with a line charged to it. */
async function projectBillIds(s: Session, projectId: string) {
  const [{ data: byHead }, { data: byLine }] = await Promise.all([
    s.supabase.from("transactions").select("id").eq("type", "bill").eq("project_id", projectId).is("voided_at", null),
    s.supabase.from("transaction_lines").select("transaction_id, transactions!inner(type, voided_at)").eq("project_id", projectId)
      .eq("transactions.type", "bill").is("transactions.voided_at", null),
  ]);
  return new Set([...(byHead ?? []).map((r) => r.id as string), ...(byLine ?? []).map((r) => r.transaction_id as string)]);
}

/** The categories a sheet row can name, in the order the template lists them. */
function categories(form: ExpenseFormData) {
  return CATEGORY_CODES.map((c) => form.accounts.find((a) => a.code === c)).filter((a): a is ExpenseFormData["accounts"][number] => Boolean(a));
}

/** What an uploaded sheet is checked against. */
export async function billLookups(s: Session, projectId: string): Promise<Lookups> {
  const [form, { data: saved }, { data: lines }] = await Promise.all([
    expenseFormData(s),
    s.supabase.from("transactions").select("id, contact_id, tax_invoice_no, number").eq("type", "bill").is("voided_at", null).not("tax_invoice_no", "is", null),
    s.supabase.from("transaction_lines").select("account_id, amount, transactions!inner(contact_id, date, number, type, voided_at, project_id)")
      .eq("transactions.type", "bill").is("transactions.voided_at", null).eq("transactions.project_id", projectId),
  ]);
  return {
    vendors: form.vendors.map((v) => ({ id: v.id, name: v.name, tin: v.tin, gst_registered: v.gst_registered })),
    accounts: categories(form).map((a) => ({ id: a.id, code: a.code, name: a.name })),
    saved: (saved ?? []).map((b) => ({ id: b.id, contact_id: b.contact_id as string, tax_invoice_no: b.tax_invoice_no as string, number: b.number })),
    savedLines: ((lines ?? []) as unknown as { account_id: string; amount: number; transactions: { contact_id: string; date: string; number: string | null } }[])
      .map((l) => ({ contact_id: l.transactions.contact_id, date: l.transactions.date, account_id: l.account_id, amount: String(l.amount), number: l.transactions.number })),
  };
}

type BillLine = { amount: number; tax_amount: number; accounts: { name: string } | null;
  transactions: { date: string; tax_invoice_no: string | null; contacts: { name: string } | null } };

/** The workbook: the Bills sheet with this project's bills, how to fill it, and the categories and shops to copy from. */
export async function billWorkbook(s: Session, projectId: string) {
  const [form, { data: project }] = await Promise.all([
    expenseFormData(s),
    s.supabase.from("projects").select("code, name").eq("id", projectId).maybeSingle(),
  ]);
  const cats = categories(form);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Receipts");
  ws.columns = SHEET_COLUMNS.map(([key, header]) => ({ key, header, width: key === "shop" ? 30 : key === "category" ? 22 : 16 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const ids = [...(await projectBillIds(s, projectId))];
  if (ids.length) {
    const { data } = await s.supabase.from("transaction_lines")
      .select("amount, tax_amount, accounts(name), transactions!inner(date, tax_invoice_no, contacts(name))")
      .in("transaction_id", ids).order("line_no");
    const lines = ((data ?? []) as unknown as BillLine[]).sort((a, b) => a.transactions.date.localeCompare(b.transactions.date));
    for (const l of lines) {
      ws.addRow({
        date: l.transactions.date, shop: l.transactions.contacts?.name ?? "", invoice_no: l.transactions.tax_invoice_no ?? "",
        category: l.accounts?.name ?? "", amount: Number(l.amount), discount: 0, gst: Number(l.tax_amount),
        total: Number(l.amount) + Number(l.tax_amount),
      });
    }
  }
  for (const k of ["amount", "discount", "gst", "total"]) ws.getColumn(k).numFmt = "#,##0.00";
  // a drop-down of the categories on every row below the heading
  const catCol = ws.getColumn("category").letter;
  // on the sheet, not the cells, so the empty rows stay empty and added rows land under the heading
  // (exceljs has this at runtime; its typings leave it out)
  const validations = (ws as unknown as { dataValidations: { add(address: string, v: ExcelJS.DataValidation): void } }).dataValidations;
  for (let r = 2; r <= 1000; r++) {
    validations.add(`${catCol}${r}`, {
      type: "list", allowBlank: true, formulae: [`Categories!$A$2:$A$${cats.length + 1}`],
      showErrorMessage: true, errorTitle: "Category", error: "Pick a category from the list (see the Categories sheet).",
    });
  }

  const help = wb.addWorksheet("How to fill");
  help.columns = [{ width: 110 }];
  for (const line of [
    `Receipts for ${project?.code ?? ""} ${project?.name ?? ""}`,
    "",
    "One row per receipt. Rows with the same shop and invoice no. become one receipt with several lines.",
    "Date: YYYY-MM-DD (2026-09-01) or day/month/year (1/9/2026).",
    "Shop: the name as on the Shops sheet. A name not on file is held on upload so you can pick the right shop (a spelling slip) or add it as new.",
    "Invoice no.: the number on the shop's receipt. Leave blank if there is none, but GST is only claimed back with it.",
    "Category: copy one from the Categories sheet (or pick from the drop-down); the account code is chosen for you. Blank means Materials.",
    "Amount: before discount and GST. Discount: blank if none. GST: as printed on the receipt.",
    "Total: as printed on the receipt; it is checked against amount − discount + GST. Blank to skip the check.",
    "GST is claimed back when the shop is GST-registered with a TIN on file and the row has an invoice no.; otherwise it is added to cost.",
    "Rows already saved (same shop and invoice no.) are recognised and skipped, so you can upload the same sheet again after adding rows.",
  ]) help.addRow([line]);
  help.getRow(1).font = { bold: true, size: 13 };

  const cat = wb.addWorksheet("Categories");
  cat.columns = [{ header: "Category", key: "name", width: 26 }, { header: "Account code (set for you)", key: "code", width: 26 }];
  cat.getRow(1).font = { bold: true };
  for (const a of cats) cat.addRow({ name: a.name, code: a.code });

  const ven = wb.addWorksheet("Shops");
  ven.columns = [{ header: "Shop", key: "name", width: 36 }, { header: "TIN", key: "tin", width: 20 }, { header: "GST registered", key: "gst", width: 16 }];
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
    ws = wb.getWorksheet("Receipts") ?? wb.getWorksheet("Bills") ?? wb.worksheets[0];
  }
  if (!ws) return [];
  // columns by their header, so a sheet with columns moved still reads
  // row values are a sparse array (index 0 and empty cells are holes)
  const header = Array.from(ws.getRow(1).values as ExcelJS.CellValue[], (v) => cellText(v ?? null).toLowerCase());
  const colOf = new Map<string, number>();
  for (const [key, label] of SHEET_COLUMNS) {
    const names = [label.toLowerCase().split(" (")[0], ...(HEADER_ALIASES[key] ?? [])];
    // the exact heading first, then one starting with it ("Date (YYYY-MM-DD)"), then the other names it goes by
    let i = header.findIndex((h, n) => n > 0 && h === label.toLowerCase());
    for (const name of names) if (i <= 0) i = header.findIndex((h, n) => n > 0 && (h === name || h.startsWith(`${name} (`)));
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
