"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";
import { moneyToDb, toLaari, laariToDb } from "@/lib/money";

export type Result = { error?: string; ok?: boolean; id?: string };

const DOC_TYPES = ["invoice", "credit_note", "sales_receipt"] as const;
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
  if (!canWrite(s.role)) return { error: "You can view but not change sales." } as const;
  return { s } as const;
}
function refresh(id?: string) {
  revalidatePath("/sales", "layout");
  revalidatePath("/projects", "layout");
  if (id) revalidatePath(`/print/sales/${id}`);
}

type LineIn = { description?: string; qty?: string; rate?: string; amount?: string; tax_code_id?: string; project_id?: string; account_id?: string };

/**
 * Save an invoice, credit note or sales receipt and post it, in one database
 * transaction. Lines arrive as JSON; every amount is checked and sent as an
 * exact decimal. GST is worked out by the database from the tax code and date.
 */
export async function saveSalesDoc(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const type = text(fd, "type") as DocType | null;
  if (!type || !DOC_TYPES.includes(type)) return { error: "Unknown document." };
  const id = text(fd, "id");
  const date = text(fd, "date");
  const contact = text(fd, "contact_id");
  if (!isDate(date)) return { error: "Enter the date." };
  if (!isId(contact)) return { error: "Choose the customer." };
  const due = text(fd, "due_date");
  if (due !== null && !isDate(due)) return { error: "Enter the due date as a date." };
  if (due && due < date) return { error: "The due date cannot be before the document date." };
  const currency = text(fd, "currency") ?? "MVR";
  const fx = currency === "MVR" ? "1" : text(fd, "fx_rate");
  if (!fx || !/^\d{1,6}(\.\d{1,6})?$/.test(fx) || /^0+(\.0+)?$/.test(fx)) return { error: "Enter the exchange rate: MVR for one unit." };

  let raw: LineIn[];
  try { raw = JSON.parse(String(fd.get("lines") ?? "[]")); } catch { return { error: "The lines could not be read." }; }
  const lines = [];
  for (const [i, l] of raw.entries()) {
    const hasQty = (l.qty ?? "") !== "" && (l.rate ?? "") !== "";
    if (!l.description?.trim() && !l.amount && !hasQty) continue;   // an empty row
    if (!l.description?.trim()) return { error: `Line ${i + 1} needs a description.` };
    let amount: string | null;
    let qty: string | null = null, rate: string | null = null;
    if (hasQty) {
      if (!/^\d+(\.\d{1,4})?$/.test(String(l.qty)) || !/^-?\d+(\.\d{1,4})?$/.test(String(l.rate))) return { error: `Line ${i + 1}: quantity and rate must be numbers (up to 4 decimals).` };
      qty = String(l.qty); rate = String(l.rate);
      amount = "0";   // the database works it out as qty × rate, to the laari
    } else {
      amount = moneyToDb(l.amount);
      if (amount === null) return { error: `Line ${i + 1}: enter the amount.` };
    }
    if (amount.startsWith("-") || (rate ?? "").startsWith("-")) return { error: `Line ${i + 1}: amounts are positive; use a credit note to reduce what is owed.` };
    lines.push({
      description: l.description.trim(), qty, rate, amount,
      tax_code_id: isId(l.tax_code_id) ? l.tax_code_id : null,
      project_id: isId(l.project_id) ? l.project_id : (text(fd, "project_id") ?? null),
      account_id: isId(l.account_id) ? l.account_id : null,
    });
  }
  if (!lines.length) return { error: "Add at least one line." };

  const payload = {
    id: id ?? undefined, type, date, due_date: type === "invoice" ? (due ?? date) : null, contact_id: contact,
    project_id: text(fd, "project_id"), currency, fx_rate: fx, memo: text(fd, "memo"), reference: text(fd, "reference"),
    bank_account_id: type === "sales_receipt" ? text(fd, "bank_account_id") : null,
    is_draft: fd.get("draft") === "on", lines,
  };
  const { data, error } = await w.s.supabase.rpc("rpc_save_transaction", { p: payload });
  if (error) return { error: dbMessage(error) };
  refresh(data as string);
  return { ok: true, id: data as string };
}

type Apply = { to: string; amount: string };
function parseApplications(fd: FormData): { apps: Apply[]; total: bigint } | { error: string } {
  let raw: { to?: string; amount?: string }[];
  try { raw = JSON.parse(String(fd.get("applications") ?? "[]")); } catch { return { error: "The invoices to apply could not be read." }; }
  const apps: Apply[] = [];
  let total = 0n;
  for (const a of raw) {
    if (!a.amount || a.amount === "0" ) continue;
    const v = toLaari(a.amount);
    if (!isId(a.to) || v === null || v < 0n) return { error: "Each amount applied must be 0 or more." };
    if (v === 0n) continue;
    apps.push({ to: a.to, amount: laariToDb(v) });
    total += v;
  }
  return { apps, total };
}

/** Receive a payment and apply it to one or more invoices; anything left over stays as credit. */
export async function receivePayment(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const date = text(fd, "date");
  const contact = text(fd, "contact_id");
  const amount = toLaari(text(fd, "total_amount"));
  if (!isDate(date)) return { error: "Enter the date received." };
  if (!isId(contact)) return { error: "Choose the customer." };
  if (amount === null || amount <= 0n) return { error: "Enter the amount received." };
  const p = parseApplications(fd);
  if ("error" in p) return { error: p.error };
  if (p.total > amount) return { error: "More is applied to invoices than was received." };
  const bank = text(fd, "bank_account_id");   // blank: Undeposited Funds, banked later with a deposit
  const { data, error } = await w.s.supabase.rpc("rpc_save_transaction", { p: {
    type: "customer_payment", date, contact_id: contact, total_amount: laariToDb(amount), bank_account_id: bank,
    reference: text(fd, "reference"), memo: text(fd, "memo"), applications: p.apps,
  } });
  if (error) return { error: dbMessage(error) };
  refresh(data as string);
  return { ok: true, id: data as string };
}

/** Money received from a client before work is invoiced (decision B2): held as Customer Advances. */
export async function receiveAdvance(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const date = text(fd, "date");
  const contact = text(fd, "contact_id");
  const amount = toLaari(text(fd, "total_amount"));
  const bank = text(fd, "bank_account_id");
  if (!isDate(date)) return { error: "Enter the date received." };
  if (!isId(contact)) return { error: "Choose the customer." };
  if (amount === null || amount <= 0n) return { error: "Enter the amount received." };
  if (!isId(bank)) return { error: "Choose the bank account it was paid into." };
  const { data, error } = await w.s.supabase.rpc("rpc_save_transaction", { p: {
    type: "customer_advance", date, contact_id: contact, project_id: text(fd, "project_id"), total_amount: laariToDb(amount),
    bank_account_id: bank, reference: text(fd, "reference"), memo: text(fd, "memo"),
  } });
  if (error) return { error: dbMessage(error) };
  refresh(data as string);
  return { ok: true, id: data as string };
}

/** Use an advance against invoices. */
export async function applyAdvance(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const date = text(fd, "date");
  const contact = text(fd, "contact_id");
  if (!isDate(date)) return { error: "Enter the date." };
  if (!isId(contact)) return { error: "Choose the customer." };
  const p = parseApplications(fd);
  if ("error" in p) return { error: p.error };
  if (p.total <= 0n) return { error: "Enter how much of the advance to apply to each invoice." };
  const { data: bal } = await w.s.supabase.rpc("customer_advance_balance", { p_contact: contact });
  if (bal !== null && toLaari(String(bal)) !== null && p.total > (toLaari(String(bal)) ?? 0n)) return { error: `Only ${bal} of advance is left to apply.` };
  const { data, error } = await w.s.supabase.rpc("rpc_save_transaction", { p: {
    type: "advance_application", date, contact_id: contact, total_amount: laariToDb(p.total), applications: p.apps, memo: text(fd, "memo"),
  } });
  if (error) return { error: dbMessage(error) };
  refresh(data as string);
  return { ok: true, id: data as string };
}

export async function makeDeposit(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const date = text(fd, "date");
  const bank = text(fd, "bank_account_id");
  const ids = fd.getAll("receipt").map(String).filter(isId);
  if (!isDate(date)) return { error: "Enter the deposit date." };
  if (!isId(bank)) return { error: "Choose the bank account." };
  if (!ids.length) return { error: "Tick the receipts going into this deposit." };
  const { data, error } = await w.s.supabase.rpc("rpc_make_deposit", { p_bank: bank, p_date: date, p_receipts: ids, p_memo: text(fd, "memo") });
  if (error) return { error: dbMessage(error) };
  refresh(data as string);
  return { ok: true, id: data as string };
}

export async function invoiceStage(stageId: string, date: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(stageId) || !isDate(date)) return { error: "Choose the stage and date." };
  const { data, error } = await w.s.supabase.rpc("rpc_invoice_stage", { p_stage: stageId, p_date: date });
  if (error) return { error: dbMessage(error) };
  refresh(data as string);
  return { ok: true, id: data as string };
}

export async function voidSalesDoc(id: string, reason: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!reason.trim()) return { error: "Say why it is being voided." };
  const { error } = await w.s.supabase.rpc("rpc_void", { p_id: id, p_reason: reason.trim() });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { ok: true };
}

export async function markSent(id: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { error } = await w.s.supabase.rpc("rpc_mark_sent", { p_id: id });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { ok: true };
}
