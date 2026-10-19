/**
 * Bills from a spreadsheet, for one project. The sheet has one row per bill
 * line; rows with the same vendor and supplier invoice number make one bill.
 * Rows already saved (an ID from a download, or a vendor + invoice number
 * already on a bill) are recognised and skipped, so a sheet can be uploaded
 * again after adding rows. Amounts stay in laari.
 */
import { laariToDb, toLaari } from "./money";

export const SHEET_COLUMNS = [
  ["id", "ID (leave blank)"],
  ["date", "Bill date (YYYY-MM-DD)"],
  ["due_date", "Due date (optional)"],
  ["vendor", "Vendor"],
  ["vendor_tin", "Vendor TIN"],
  ["invoice_no", "Supplier invoice no."],
  ["invoice_date", "Supplier invoice date (optional)"],
  ["description", "Description"],
  ["account", "Account code"],
  ["amount", "Amount before GST"],
  ["gst", "GST"],
  ["claimable", "GST claimable (Y/N)"],
  ["reference", "Reference (optional)"],
] as const;
export type RawRow = { row: number } & Partial<Record<(typeof SHEET_COLUMNS)[number][0], string>>;

export type Lookups = {
  vendors: { id: string; name: string; tin: string | null; gst_registered: boolean }[];
  accounts: { id: string; code: string; name: string }[];
  /** bills already on this project (ids), and every saved bill's vendor + supplier invoice no. */
  projectBillIds: Set<string>;
  saved: { id: string; contact_id: string; tax_invoice_no: string; number: string | null }[];
  /** the lines of bills already on this project, to recognise rows that have no supplier invoice no. */
  savedLines?: { contact_id: string; date: string; account_id: string; amount: string; description: string | null; number: string | null }[];
};

export type PreviewRow = {
  row: number; status: "new" | "saved" | "error"; errors: string[]; note?: string;
  date: string; due_date: string | null; vendor: string; vendor_id: string | null; new_vendor: boolean; vendor_tin: string | null;
  invoice_no: string | null; invoice_date: string | null; description: string; account_id: string | null; account: string;
  amount: string; gst: string; claimable: boolean; reference: string | null; group: string;
};
export type BillGroup = {
  key: string; rows: number[]; date: string; due_date: string | null; vendor: string; vendor_id: string | null; new_vendor: boolean;
  vendor_tin: string | null; invoice_no: string | null; invoice_date: string | null; reference: string | null;
  lines: { description: string; account_id: string; amount: string; tax_amount: string; gst_claimable: boolean }[];
  total: string;
};

const norm = (s: string | undefined | null) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const clean = (s: string | undefined) => { const v = (s ?? "").trim(); return v === "" ? null : v; };
// strict: 2026-02-31 is not a date (JavaScript would roll it into March)
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** A date typed or exported in common shapes, as YYYY-MM-DD; null if not a date. */
export function readDate(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (isDate(s)) return s;
  let m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); // day/month/year, as used in the Maldives
  if (m) { const d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; return isDate(d) ? d : null; }
  return null;
}

/** Check every row against the books, and group the new ones into bills. */
export function checkRows(raw: RawRow[], look: Lookups): { rows: PreviewRow[]; bills: BillGroup[] } {
  const byName = new Map(look.vendors.map((v) => [norm(v.name), v]));
  const byTin = new Map(look.vendors.filter((v) => v.tin).map((v) => [norm(v.tin), v]));
  const acct = (s: string) => look.accounts.find((a) => norm(a.code) === norm(s)) ?? look.accounts.find((a) => norm(a.name) === norm(s));
  const savedKey = new Map(look.saved.map((b) => [`${b.contact_id}|${norm(b.tax_invoice_no)}`, b]));
  const lineKey = (contact: string, d: string, account: string, amount: string, desc: string | null) => [contact, d, account, amount, norm(desc)].join("|");
  const savedLine = new Map((look.savedLines ?? []).map((l) => [lineKey(l.contact_id, l.date, l.account_id, (toLaari(l.amount) ?? 0n).toString(), l.description), l]));
  const rows: PreviewRow[] = [];

  for (const r of raw) {
    const errors: string[] = [];
    const vendorName = (r.vendor ?? "").trim();
    const tin = clean(r.vendor_tin);
    const v = (tin && byTin.get(norm(tin))) || byName.get(norm(vendorName)) || null;
    const date = readDate(r.date);
    const due = clean(r.due_date) ? readDate(r.due_date) : null;
    const invDate = clean(r.invoice_date) ? readDate(r.invoice_date) : null;
    const amount = toLaari(r.amount ?? "");
    const gst = clean(r.gst) ? toLaari(r.gst ?? "") : 0n;
    const claimRaw = norm(r.claimable);
    const claimable = ["y", "yes", "true", "1"].includes(claimRaw);
    const a = clean(r.account) ? acct(r.account!) : undefined;
    const invoiceNo = clean(r.invoice_no);

    if (!date) errors.push("Bill date missing or not a date");
    if (clean(r.due_date) && !due) errors.push("Due date is not a date");
    if (date && due && due < date) errors.push("Due date is before the bill date");
    if (clean(r.invoice_date) && !invDate) errors.push("Supplier invoice date is not a date");
    if (!vendorName && !v) errors.push("Vendor missing");
    if (!clean(r.account)) errors.push("Account code missing");
    else if (!a) errors.push(`No account "${r.account}"`);
    if (amount === null || amount <= 0n) errors.push("Amount before GST must be a number above 0");
    if (gst === null || (gst ?? 0n) < 0n) errors.push("GST must be a number (or blank)");
    if (claimRaw && !["y", "yes", "true", "1", "n", "no", "false", "0"].includes(claimRaw)) errors.push("GST claimable must be Y or N");
    if (claimable && (gst ?? 0n) > 0n) {
      if (!(tin ?? v?.tin)) errors.push("Claiming GST needs the vendor's TIN");
      if (!invoiceNo) errors.push("Claiming GST needs the supplier invoice no.");
      if (v && !v.gst_registered) errors.push(`${v.name} is not marked GST-registered (Vendors), so the GST cannot be claimed`);
    }

    let status: PreviewRow["status"] = errors.length ? "error" : "new";
    let note: string | undefined;
    const id = clean(r.id);
    if (id && look.projectBillIds.has(id)) { status = "saved"; note = "Already saved (from the download)"; errors.length = 0; }
    else if (id) { errors.push("This ID is not a bill on this project; clear the ID to add it as new"); status = "error"; }
    else if (v && invoiceNo && savedKey.has(`${v.id}|${norm(invoiceNo)}`)) {
      const b = savedKey.get(`${v.id}|${norm(invoiceNo)}`)!;
      status = "saved"; note = `Already saved as ${b.number ?? "a bill"}`; errors.length = 0;
    } else if (!invoiceNo && v && date && a && amount !== null && status === "new") {
      // no invoice number to go by: the same vendor, date, account, amount and description on this project's bills
      const l = savedLine.get(lineKey(v.id, date, a.id, amount.toString(), r.description ?? null));
      if (l) { status = "saved"; note = `Looks already saved as ${l.number ?? "a bill"} (same vendor, date, account, amount and description)`; }
    }

    rows.push({
      row: r.row, status, errors, note, date: date ?? (r.date ?? ""), due_date: due, vendor: v?.name ?? vendorName, vendor_id: v?.id ?? null,
      new_vendor: !v && Boolean(vendorName), vendor_tin: tin ?? v?.tin ?? null, invoice_no: invoiceNo, invoice_date: invDate,
      description: (r.description ?? "").trim(), account_id: a?.id ?? null, account: a ? `${a.code} ${a.name}` : (r.account ?? ""),
      amount: amount !== null && amount > 0n ? laariToDb(amount) : (r.amount ?? ""), gst: gst !== null ? laariToDb(gst) : (r.gst ?? ""),
      claimable: claimable && (gst ?? 0n) > 0n, reference: clean(r.reference),
      group: invoiceNo ? `${v?.id ?? `new:${norm(vendorName)}`}|${norm(invoiceNo)}` : `row:${r.row}`,
    });
  }

  // one bill per vendor + invoice number; its rows must agree on the bill's date
  const bills = new Map<string, BillGroup>();
  for (const p of rows.filter((x) => x.status === "new")) {
    const g = bills.get(p.group);
    if (g && g.date !== p.date) { p.status = "error"; p.errors.push(`Same supplier invoice as row ${g.rows[0]} but a different date`); continue; }
    const b = g ?? { key: p.group, rows: [], date: p.date, due_date: p.due_date, vendor: p.vendor, vendor_id: p.vendor_id, new_vendor: p.new_vendor,
      vendor_tin: p.vendor_tin, invoice_no: p.invoice_no, invoice_date: p.invoice_date ?? (p.claimable ? p.date : null), reference: p.reference, lines: [], total: "0.00" };
    b.rows.push(p.row);
    b.lines.push({ description: p.description, account_id: p.account_id!, amount: p.amount, tax_amount: p.gst, gst_claimable: p.claimable });
    if (p.claimable && !b.invoice_date) b.invoice_date = p.date;
    b.total = laariToDb((toLaari(b.total) ?? 0n) + (toLaari(p.amount) ?? 0n) + (toLaari(p.gst) ?? 0n));
    bills.set(p.group, b);
  }
  return { rows, bills: [...bills.values()] };
}
