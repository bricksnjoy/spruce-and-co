/**
 * Bills from a spreadsheet, for one project, the way they come off a shop's
 * receipt: date, shop, invoice no., category, amount, discount, GST, total.
 * The category picks the account; a shop not on file is held until it is
 * matched to one (a misspelling) or confirmed as new. Rows with the same shop
 * and invoice no. make one bill. Rows already saved (the same shop and
 * invoice no., or the same shop, date, category and amount on this project)
 * are recognised and skipped, so a sheet can be uploaded again after adding
 * rows. Amounts stay in laari.
 */
import { laariToDb, toLaari } from "./money";

export const SHEET_COLUMNS = [
  ["date", "Date"],
  ["shop", "Shop"],
  ["invoice_no", "Invoice no. (optional)"],
  ["category", "Category"],
  ["amount", "Amount"],
  ["discount", "Discount"],
  ["gst", "GST"],
  ["total", "Total"],
] as const;
export type SheetKey = (typeof SHEET_COLUMNS)[number][0];
/** Other headings a column is recognised by (older templates, other wording). */
export const HEADER_ALIASES: Partial<Record<SheetKey, string[]>> = {
  date: ["bill date", "receipt date"],
  shop: ["vendor", "supplier"],
  invoice_no: ["supplier invoice no.", "invoice no", "invoice number", "receipt no."],
  category: ["account code", "account"],
  amount: ["amount before gst", "subtotal"],
};
export type RawRow = { row: number } & Partial<Record<SheetKey, string>>;

/** The cost categories a bill row can name: a project's job-cost accounts. */
export const CATEGORY_CODES = ["5000", "5010", "5030", "5040", "5050"];
export const DEFAULT_CATEGORY = "5000";

export type Vendor = { id: string; name: string; tin: string | null; gst_registered: boolean };
export type Lookups = {
  vendors: Vendor[];
  /** the categories, as accounts */
  accounts: { id: string; code: string; name: string }[];
  /** every saved bill's shop + invoice no. */
  saved: { id: string; contact_id: string; tax_invoice_no: string; number: string | null }[];
  /** the lines of bills already on this project, to recognise rows that have no invoice no. */
  savedLines?: { contact_id: string; date: string; account_id: string; amount: string; number: string | null }[];
};
/** What the person chose for each shop name not on file: a shop's id, or "new" to add it. */
export type ShopChoices = Record<string, string>;

export type PreviewRow = {
  row: number; status: "new" | "saved" | "error"; errors: string[]; note?: string;
  date: string; shop: string; typed_shop: string; vendor_id: string | null; new_vendor: boolean; vendor_tin: string | null;
  invoice_no: string | null; category: string; account_id: string | null;
  amount: string; discount: string; net: string; gst: string; total: string; claimable: boolean; group: string;
};
export type BillGroup = {
  key: string; rows: number[]; date: string; vendor: string; vendor_id: string | null; new_vendor: boolean;
  vendor_tin: string | null; invoice_no: string | null; invoice_date: string | null;
  lines: { description: string | null; account_id: string; amount: string; tax_amount: string; gst_claimable: boolean }[];
  total: string;
};
/** A shop named in the sheet but not on file, with the closest names that are. */
export type UnknownShop = { name: string; rows: number[]; suggestions: { id: string; name: string }[]; choice: string | null };

export const norm = (s: string | undefined | null) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
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

/** Edit distance between two names, for "did you mean". */
function distance(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/** The shops on file closest to a name typed in the sheet, best first. */
export function closestShops(name: string, vendors: Vendor[], max = 3) {
  const n = norm(name).replace(/[^a-z0-9 ]/g, "");
  return vendors
    .map((v) => {
      const m = norm(v.name).replace(/[^a-z0-9 ]/g, "");
      const score = distance(n, m) / Math.max(n.length, m.length, 1) - (m.includes(n) || n.includes(m) ? 0.3 : 0);
      return { id: v.id, name: v.name, score };
    })
    .filter((x) => x.score <= 0.5)
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map(({ id, name }) => ({ id, name }));
}

/** Check every row against the books, and group the new ones into bills. */
export function checkRows(raw: RawRow[], look: Lookups, choices: ShopChoices = {}): { rows: PreviewRow[]; bills: BillGroup[]; unknownShops: UnknownShop[] } {
  const byName = new Map(look.vendors.map((v) => [norm(v.name), v]));
  const byId = new Map(look.vendors.map((v) => [v.id, v]));
  const category = (s: string | null) => {
    if (!s) return look.accounts.find((a) => a.code === DEFAULT_CATEGORY);
    return look.accounts.find((a) => norm(a.name) === norm(s)) ?? look.accounts.find((a) => norm(a.code) === norm(s))
      ?? look.accounts.find((a) => `${norm(a.code)} ${norm(a.name)}` === norm(s));
  };
  const savedKey = new Map(look.saved.map((b) => [`${b.contact_id}|${norm(b.tax_invoice_no)}`, b]));
  const lineKey = (contact: string, d: string, account: string, amount: bigint) => [contact, d, account, amount.toString()].join("|");
  const savedLine = new Map((look.savedLines ?? []).map((l) => [lineKey(l.contact_id, l.date, l.account_id, toLaari(l.amount) ?? 0n), l]));
  const unknown = new Map<string, UnknownShop>();
  const rows: PreviewRow[] = [];

  for (const r of raw) {
    const errors: string[] = [];
    const notes: string[] = [];
    const typed = (r.shop ?? "").trim();
    const choice = choices[norm(typed)] ?? null;
    let v = byName.get(norm(typed)) ?? null;
    let newVendor = false;
    if (!v && typed) {
      const u = unknown.get(norm(typed)) ?? { name: typed, rows: [], suggestions: closestShops(typed, look.vendors), choice };
      u.rows.push(r.row);
      unknown.set(norm(typed), u);
      if (choice === "new") newVendor = true;
      else if (choice && byId.has(choice)) v = byId.get(choice)!;
      else errors.push(`Shop "${typed}" is not on file: pick the right shop below, or add it as new`);
    }

    const date = readDate(r.date);
    const amount = toLaari(r.amount ?? "");
    const discount = clean(r.discount) ? toLaari(r.discount) : 0n;
    const gst = clean(r.gst) ? toLaari(r.gst) : 0n;
    const totalTyped = clean(r.total) ? toLaari(r.total) : null;
    const cat = category(clean(r.category));
    const invoiceNo = clean(r.invoice_no);

    if (!date) errors.push("Date missing or not a date");
    if (!typed) errors.push("Shop missing");
    if (!cat) errors.push(`No category "${r.category}" (see the Categories sheet)`);
    if (amount === null || amount <= 0n) errors.push("Amount must be a number above 0");
    if (discount === null || discount < 0n) errors.push("Discount must be a number (or blank)");
    else if (amount !== null && discount >= amount) errors.push("Discount is not less than the amount");
    if (gst === null || gst < 0n) errors.push("GST must be a number (or blank)");
    if (clean(r.total) && totalTyped === null) errors.push("Total must be a number (or blank)");

    const net = amount !== null && discount !== null ? amount - discount : null;
    const total = net !== null && gst !== null ? net + gst : null;
    if (total !== null && totalTyped !== null && totalTyped !== total) {
      errors.push(`Total is ${laariToDb(totalTyped)} but amount − discount + GST is ${laariToDb(total)}`);
    }

    // GST comes back from MIRA only on a GST-registered shop's tax invoice; otherwise it is cost
    const tin = v?.tin ?? null;
    const claimable = Boolean(gst && gst > 0n && invoiceNo && v?.gst_registered && tin);
    if (gst && gst > 0n && !claimable && !errors.length) {
      notes.push(!invoiceNo ? "GST added to cost: no invoice no."
        : newVendor || !v?.gst_registered ? "GST added to cost: shop not marked GST-registered (Vendors)"
        : "GST added to cost: shop has no TIN on file (Vendors)");
    }

    let status: PreviewRow["status"] = errors.length ? "error" : "new";
    const contact = v?.id ?? null;
    if (status === "new" && contact && invoiceNo && savedKey.has(`${contact}|${norm(invoiceNo)}`)) {
      const b = savedKey.get(`${contact}|${norm(invoiceNo)}`)!;
      status = "saved"; notes.splice(0, notes.length, `Already saved as ${b.number ?? "a receipt"}`);
    } else if (status === "new" && !invoiceNo && contact && date && cat && net !== null) {
      // no invoice number to go by: the same shop, date, category and amount on this project's bills
      const l = savedLine.get(lineKey(contact, date, cat.id, net));
      if (l) { status = "saved"; notes.splice(0, notes.length, `Looks already saved as ${l.number ?? "a receipt"} (same shop, date, category and amount)`); }
    }

    const shop = v?.name ?? typed;
    rows.push({
      row: r.row, status, errors, note: notes.join("; ") || undefined, date: date ?? (r.date ?? ""), shop, typed_shop: typed,
      vendor_id: contact, new_vendor: newVendor, vendor_tin: tin, invoice_no: invoiceNo,
      category: cat ? cat.name : (r.category ?? ""), account_id: cat?.id ?? null,
      amount: amount !== null ? laariToDb(amount) : (r.amount ?? ""), discount: discount !== null ? laariToDb(discount) : (r.discount ?? ""),
      net: net !== null ? laariToDb(net) : "", gst: gst !== null ? laariToDb(gst) : (r.gst ?? ""), total: total !== null ? laariToDb(total) : "",
      claimable, group: invoiceNo ? `${contact ?? `new:${norm(shop)}`}|${norm(invoiceNo)}` : `row:${r.row}`,
    });
  }

  // one bill per shop + invoice number; its rows must agree on the date
  const bills = new Map<string, BillGroup>();
  for (const p of rows.filter((x) => x.status === "new")) {
    const g = bills.get(p.group);
    if (g && g.date !== p.date) { p.status = "error"; p.errors.push(`Same invoice as row ${g.rows[0]} but a different date`); continue; }
    const b = g ?? { key: p.group, rows: [], date: p.date, vendor: p.shop, vendor_id: p.vendor_id, new_vendor: p.new_vendor,
      vendor_tin: p.vendor_tin, invoice_no: p.invoice_no, invoice_date: p.invoice_no ? p.date : null, lines: [], total: "0.00" };
    b.rows.push(p.row);
    const discounted = p.discount !== "0.00" ? `${p.category}, less ${p.discount} discount` : null;
    b.lines.push({ description: discounted, account_id: p.account_id!, amount: p.net, tax_amount: p.gst, gst_claimable: p.claimable });
    b.total = laariToDb((toLaari(b.total) ?? 0n) + (toLaari(p.total) ?? 0n));
    bills.set(p.group, b);
  }
  return { rows, bills: [...bills.values()], unknownShops: [...unknown.values()] };
}
