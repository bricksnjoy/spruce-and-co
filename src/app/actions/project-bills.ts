"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";
import { billLookups, readBillSheet } from "@/server/project-bills";
import { checkRows, type BillGroup, type PreviewRow, type RawRow, type ShopChoices, type UnknownShop } from "@/lib/bill-import";

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
export type Preview = {
  error?: string; raw?: RawRow[]; rows?: PreviewRow[]; bills?: number; total?: string;
  /** shop names not on file, and every shop to pick from instead */
  unknownShops?: UnknownShop[]; shops?: { id: string; name: string }[];
};
export type SaveResult = { error?: string; saved?: number; skipped?: number; failed?: { rows: number[]; error: string }[]; notes?: string[] };

async function writer() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!canWrite(s.role)) return { error: "You can view but not add bills." } as const;
  return { s } as const;
}

/** Read an uploaded sheet and check every row; nothing is saved yet. */
export async function previewBillSheet(projectId: string, fd: FormData): Promise<Preview> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(projectId)) return { error: "No project." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the filled-in sheet (.xlsx or .csv)." };
  if (file.size > 5 * 1024 * 1024) return { error: "That file is over 5 MB; is it the right sheet?" };
  let raw: RawRow[];
  try { raw = await readBillSheet(file); } catch { return { error: "That file could not be read. Save it as .xlsx (or .csv) and try again." }; }
  if (!raw.length) return { error: "The sheet has no rows under the headings." };
  if (raw.length > 1000) return { error: "Upload up to 1,000 rows at a time." };
  return check(w.s, projectId, raw, {});
}

/** Check the uploaded rows again with the shops chosen for names not on file. */
export async function recheckBillSheet(projectId: string, raw: RawRow[], choices: ShopChoices): Promise<Preview> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(projectId)) return { error: "No project." };
  if (!Array.isArray(raw) || !raw.length || raw.length > 1000) return { error: "Nothing to check." };
  return check(w.s, projectId, raw, choices);
}

async function check(s: S, projectId: string, raw: RawRow[], choices: ShopChoices): Promise<Preview> {
  const look = await billLookups(s, projectId);
  const { rows, bills, unknownShops } = checkRows(raw, look, choices);
  const total = bills.reduce((t, b) => t + Number(b.total), 0).toFixed(2);
  return { raw, rows, bills: bills.length, total, unknownShops, shops: look.vendors.map((v) => ({ id: v.id, name: v.name })) };
}

/**
 * Save the new bills from checked rows. The rows are checked again here, so
 * only what the preview showed as new is saved; anything already saved is
 * skipped, which makes uploading the same sheet twice harmless.
 */
export async function saveBillSheet(projectId: string, raw: RawRow[], choices: ShopChoices = {}, paidFrom: string | null = null): Promise<SaveResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const s = w.s;
  if (!isId(projectId)) return { error: "No project." };
  if (!Array.isArray(raw) || raw.length > 1000) return { error: "Nothing to save." };
  if (paidFrom !== null && !isId(paidFrom)) return { error: "Choose the account they were paid from." };
  const { rows, bills } = checkRows(raw, await billLookups(s, projectId), choices ?? {});
  if (rows.some((r) => r.status === "error")) return { error: "Some rows still have problems. Pick the shops above, or fix the rows in the sheet and upload it again." };

  const vendorIds = new Map<string, string>();
  const failed: { rows: number[]; error: string }[] = [];
  const notes: string[] = [];
  let saved = 0;
  for (const b of bills) {
    try {
      const contact = b.vendor_id ?? (await newVendor(s, b, vendorIds));
      const id = await saveOne(s, projectId, b, contact);
      if (id.note) notes.push(`Rows ${b.rows.join(", ")}: ${id.note}`);
      // a receipt is entered once paid: record the payment on its date, unless it waits for approval
      if (paidFrom && !id.pending) {
        const paid = await payInFull(s, id.id, b.date, paidFrom);
        if (paid) notes.push(`Rows ${b.rows.join(", ")}: saved, but not marked paid: ${paid}`);
      }
      saved++;
    } catch (e) {
      failed.push({ rows: b.rows, error: (e as Error).message });
    }
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/expenses");
  return { saved, skipped: rows.filter((r) => r.status === "saved").length, failed, notes };
}

/**
 * Mark a project's bills paid in full from one money account, each on its own
 * date (a receipt is paid the day it is dated). Bills already paid are left as they are.
 */
export async function markBillsPaid(projectId: string, billIds: string[], bank: string): Promise<{ error?: string; paid?: number; failed?: string[] }> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(projectId) || !isId(bank)) return { error: "Choose the account they were paid from." };
  if (!Array.isArray(billIds) || !billIds.length || billIds.length > 500 || !billIds.every(isId)) return { error: "Choose the bills." };
  const { data } = await w.s.supabase.from("document_balances_v").select("id, number, date, balance, type").in("id", billIds);
  let paid = 0;
  const failed: string[] = [];
  for (const b of data ?? []) {
    if (b.type !== "bill" || Number(b.balance) <= 0) continue;
    const err = await payInFull(w.s, b.id, b.date, bank);
    if (err) failed.push(`${b.number ?? "A bill"}: ${err}`); else paid++;
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/expenses");
  return { paid, failed };
}

type S = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Pay a bill's whole balance from one account on a date; the error, if any. */
async function payInFull(s: S, bill: string, date: string, bank: string): Promise<string | null> {
  const { data } = await s.supabase.from("document_balances_v").select("balance").eq("id", bill).maybeSingle();
  if (!data || Number(data.balance) <= 0) return null;
  const { error } = await s.supabase.rpc("rpc_pay_bills", { p_bank: bank, p_date: date, p_items: [{ bill, amount: String(data.balance) }], p_reference: null });
  return error ? dbMessage(error) : null;
}

/** A shop named in the sheet, not on file and confirmed as new: added once, marked for review. */
async function newVendor(s: S, b: BillGroup, made: Map<string, string>) {
  const key = b.vendor.trim().toLowerCase();
  if (made.has(key)) return made.get(key)!;
  // TIN and GST registration are added on the Vendors page once known; until then its GST is cost
  const { data, error } = await s.supabase.from("contacts")
    .insert({ name: b.vendor.trim(), kinds: ["vendor"], needs_review: true })
    .select("id").single();
  if (error) throw new Error(`Adding vendor ${b.vendor}: ${dbMessage(error)}`);
  made.set(key, data.id);
  return data.id as string;
}

/** One bill, posted the way the bill form posts it (over the approval limit: to an admin). */
async function saveOne(s: S, projectId: string, b: BillGroup, contact: string): Promise<{ id: string; note?: string; pending?: boolean }> {
  const payload = {
    type: "bill", date: b.date, due_date: b.date, contact_id: contact, project_id: projectId, currency: "MVR", fx_rate: "1",
    reference: null, supplier_tin: b.vendor_tin, tax_invoice_no: b.invoice_no, tax_invoice_date: b.invoice_date, is_draft: false,
    memo: "From a bills sheet",
    lines: b.lines.map((l) => ({ ...l, description: l.description || null, project_id: projectId })),
  };
  let { data, error } = await s.supabase.rpc("rpc_save_transaction", { p: payload });
  if (error && /approval limit/.test(error.message)) {
    ({ data, error } = await s.supabase.rpc("rpc_save_transaction", { p: { ...payload, is_draft: true } }));
    if (error) throw new Error(dbMessage(error));
    const r = s.role === "admin"
      ? await s.supabase.rpc("rpc_approve_bill", { p_id: data })
      : await s.supabase.rpc("rpc_request_approval", { p_id: data });
    if (r.error) throw new Error(`Saved as a draft, but: ${dbMessage(r.error)}`);
    return { id: data as string, note: s.role === "admin" ? "over the approval limit: approved by you" : "over the approval limit: sent for approval", pending: s.role !== "admin" };
  }
  if (error) throw new Error(dbMessage(error));
  return { id: data as string };
}
