"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession, type Session } from "@/server/session";
import { laariToDb, moneyToDb, toLaari } from "@/lib/money";

export type Result = { error?: string; ok?: boolean; id?: string; note?: string; ids?: string[] };

const DOC_TYPES = ["bill", "expense", "vendor_credit", "purchase_order"] as const;
type DocType = (typeof DOC_TYPES)[number];
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const isDate = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

async function writer() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!canWrite(s.role)) return { error: "You can view but not change expenses." } as const;
  return { s } as const;
}
function refresh(id?: string) {
  revalidatePath("/expenses", "layout");
  revalidatePath("/projects", "layout");
  if (id) revalidatePath(`/expenses/${id}`);
}

/** Keep the receipt photo with the document (feature: receipt scanning). */
async function attachPhoto(s: Session, id: string, file: FormDataEntryValue | null): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > 20 * 1024 * 1024) return "The photo is larger than 20MB, so it was not kept.";
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `ledger/${s.book}/${id}/${Date.now()}.${ext}`;
  const { error } = await s.supabase.storage.from("bills").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "image/jpeg" });
  if (error) return `The document is saved, but the photo could not be kept: ${error.message}`;
  const { error: e2 } = await s.supabase.from("attachments").insert({ transaction_id: id, storage_path: path, file_name: file.name, mime: file.type, size_bytes: file.size });
  return e2 ? `The photo is stored but not linked: ${e2.message}` : null;
}

type LineIn = { description?: string; qty?: string; rate?: string; amount?: string; tax_amount?: string; gst_claimable?: boolean; project_id?: string; account_id?: string };

/**
 * Save a bill, expense, vendor credit or purchase order. Purchases keep the
 * supplier's own GST figure; claimable GST needs the tax-invoice evidence (the
 * database refuses otherwise). A bill over the approval limit is sent to an
 * admin instead of posting, unless an admin is saving it.
 */
export async function saveExpenseDoc(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const s = w.s;
  const type = text(fd, "type") as DocType | null;
  if (!type || !DOC_TYPES.includes(type)) return { error: "Unknown document." };
  const id = text(fd, "id");
  const date = text(fd, "date");
  const contact = text(fd, "contact_id");
  if (!isDate(date)) return { error: "Enter the date." };
  if (type !== "expense" && !isId(contact)) return { error: "Choose the vendor." };
  const due = text(fd, "due_date");
  if (due !== null && !isDate(due)) return { error: "Enter the due date as a date." };
  if (type === "bill" && due && due < date) return { error: "The due date cannot be before the bill date." };
  const bank = text(fd, "bank_account_id");
  if (type === "expense" && !isId(bank)) return { error: "Choose the account it was paid from." };
  const currency = text(fd, "currency") ?? "MVR";
  const fx = currency === "MVR" ? "1" : text(fd, "fx_rate");
  if (!fx || !/^\d{1,6}(\.\d{1,6})?$/.test(fx) || /^0+(\.0+)?$/.test(fx)) return { error: "Enter the exchange rate: MVR for one unit." };

  let raw: LineIn[];
  try { raw = JSON.parse(String(fd.get("lines") ?? "[]")); } catch { return { error: "The lines could not be read." }; }
  const lines = [];
  for (const [i, l] of raw.entries()) {
    const hasQty = (l.qty ?? "") !== "" && (l.rate ?? "") !== "";
    if (!l.description?.trim() && !l.amount && !hasQty && !l.account_id) continue;
    if (!isId(l.account_id)) return { error: `Line ${i + 1}: choose what it was for (the account).` };
    let amount: string | null, qty: string | null = null, rate: string | null = null;
    if (hasQty) {
      if (!/^\d+(\.\d{1,4})?$/.test(String(l.qty)) || !/^\d+(\.\d{1,4})?$/.test(String(l.rate))) return { error: `Line ${i + 1}: quantity and rate must be numbers (up to 4 decimals).` };
      qty = String(l.qty); rate = String(l.rate); amount = "0";
    } else {
      amount = moneyToDb(l.amount);
      if (amount === null || amount.startsWith("-")) return { error: `Line ${i + 1}: enter the amount before GST.` };
    }
    const tax = (l.tax_amount ?? "") === "" ? "0.00" : moneyToDb(l.tax_amount);
    if (tax === null || tax.startsWith("-")) return { error: `Line ${i + 1}: enter the GST charged, or leave it blank.` };
    lines.push({ description: l.description?.trim() || null, qty, rate, amount, tax_amount: tax, gst_claimable: Boolean(l.gst_claimable) && tax !== "0.00",
      project_id: isId(l.project_id) ? l.project_id : text(fd, "project_id"), account_id: l.account_id });
  }
  if (!lines.length) return { error: "Add at least one line." };

  const payload = {
    id: id ?? undefined, type, date, due_date: type === "bill" ? (due ?? date) : null, contact_id: contact,
    project_id: text(fd, "project_id"), currency, fx_rate: fx, memo: text(fd, "memo"), reference: text(fd, "reference"),
    bank_account_id: type === "expense" ? bank : null,
    supplier_tin: text(fd, "supplier_tin"), tax_invoice_no: text(fd, "tax_invoice_no"), tax_invoice_date: text(fd, "tax_invoice_date"),
    customs_ref: text(fd, "customs_ref"),
    is_draft: fd.get("draft") === "on", lines,
  };
  // the database decides whether a bill is over the approval limit (in MVR, to the laari)
  let { data, error } = await s.supabase.rpc("rpc_save_transaction", { p: payload });
  let note: string | undefined;
  if (error && type === "bill" && /approval limit/.test(error.message)) {
    ({ data, error } = await s.supabase.rpc("rpc_save_transaction", { p: { ...payload, is_draft: true } }));
    if (error) return { error: dbMessage(error) };
    const r = s.role === "admin"
      ? await s.supabase.rpc("rpc_approve_bill", { p_id: data })
      : await s.supabase.rpc("rpc_request_approval", { p_id: data });
    if (r.error) return { error: `Saved as a draft, but: ${dbMessage(r.error)}`, id: data as string };
    note = s.role === "admin" ? "Over the approval limit: approved by you and posted." : "Over the approval limit: sent to an admin for approval.";
  }
  if (error) return { error: dbMessage(error) };
  const docId = data as string;

  const photo = await attachPhoto(s, docId, fd.get("photo"));
  refresh(docId);
  return { ok: true, id: docId, note: [note, photo].filter(Boolean).join(" ") || undefined };
}

/** Pay several bills from one account: one payment per vendor. */
export async function payBills(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const date = text(fd, "date");
  const bank = text(fd, "bank_account_id");
  if (!isDate(date)) return { error: "Enter the payment date." };
  if (!isId(bank)) return { error: "Choose the account to pay from." };
  let raw: { bill?: string; amount?: string }[];
  try { raw = JSON.parse(String(fd.get("items") ?? "[]")); } catch { return { error: "The bills could not be read." }; }
  const items = [];
  for (const r of raw) {
    const v = toLaari(r.amount);
    if (!isId(r.bill) || v === null) return { error: "Each amount must be a number." };
    if (v > 0n) items.push({ bill: r.bill, amount: laariToDb(v) });
  }
  if (!items.length) return { error: "Tick the bills to pay." };
  const { data, error } = await w.s.supabase.rpc("rpc_pay_bills", { p_bank: bank, p_date: date, p_items: items, p_reference: text(fd, "reference") });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true, ids: data as string[] };
}

export async function applyCredit(fromId: string, toId: string, amount: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const v = toLaari(amount);
  if (!isId(fromId) || !isId(toId) || v === null || v <= 0n) return { error: "Enter the amount to apply." };
  const { error } = await w.s.supabase.rpc("rpc_apply_credit", { p_from: fromId, p_to: toId, p_amount: laariToDb(v) });
  if (error) return { error: dbMessage(error) };
  refresh(fromId); refresh(toId);
  revalidatePath("/sales", "layout");
  return { ok: true };
}

export async function approveBill(id: string): Promise<Result> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  if (s.role !== "admin") return { error: "Only an admin approves bills." };
  const { error } = await s.supabase.rpc("rpc_approve_bill", { p_id: id });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { ok: true };
}

export async function billFromPo(id: string, date: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { data, error } = await w.s.supabase.rpc("rpc_bill_from_po", { p_po: id, p_date: date });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { ok: true, id: data as string };
}

export async function closePo(id: string, reopen: boolean): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { error } = await w.s.supabase.rpc("rpc_close_po", { p_po: id, p_open: reopen });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { ok: true };
}

export async function voidExpenseDoc(id: string, reason: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!reason.trim()) return { error: "Say why it is being voided." };
  const { error } = await w.s.supabase.rpc("rpc_void", { p_id: id, p_reason: reason.trim() });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { ok: true };
}
