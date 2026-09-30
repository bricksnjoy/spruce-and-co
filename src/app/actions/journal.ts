"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";
import { laariToDb, toLaari } from "@/lib/money";

export type Result = { error?: string; ok?: boolean; id?: string };
type Line = { account_id: string; description?: string; debit?: string; credit?: string; contact_id?: string; project_id?: string };
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/**
 * A manual journal entry, or opening balances (§9 Accounting). A journal must
 * balance; opening balances may not, and the difference goes to Opening
 * Balance Equity when posted.
 */
export async function saveJournal(_prev: unknown, fd: FormData): Promise<Result> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  if (!canWrite(s.role)) return { error: "You can view but not change the books." };
  const type = fd.get("type") === "opening_balance" ? "opening_balance" : "journal";
  const date = String(fd.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the date." };
  let raw: Line[];
  try { raw = JSON.parse(String(fd.get("lines") ?? "[]")); } catch { return { error: "The lines could not be read." }; }
  const lines = [];
  let dr = 0n, cr = 0n;
  for (const [i, l] of raw.entries()) {
    const d = l.debit?.trim() ? toLaari(l.debit) : 0n;
    const c = l.credit?.trim() ? toLaari(l.credit) : 0n;
    if (d === null || c === null) return { error: `Line ${i + 1}: amounts must be numbers.` };
    if (d === 0n && c === 0n && !l.account_id) continue;
    if (!isId(l.account_id)) return { error: `Line ${i + 1}: choose the account.` };
    if (d < 0n || c < 0n) return { error: `Line ${i + 1}: enter amounts as positive debits or credits.` };
    if (d > 0n && c > 0n) return { error: `Line ${i + 1}: a line is either a debit or a credit.` };
    if (d === 0n && c === 0n) return { error: `Line ${i + 1}: enter a debit or a credit.` };
    dr += d; cr += c;
    lines.push({ account_id: l.account_id, description: l.description?.trim() || null, debit: laariToDb(d), credit: laariToDb(c),
      contact_id: isId(l.contact_id) ? l.contact_id : null, project_id: isId(l.project_id) ? l.project_id : null });
  }
  if (lines.length < (type === "journal" ? 2 : 1)) return { error: type === "journal" ? "A journal entry needs at least two lines." : "Enter at least one opening balance." };
  if (type === "journal" && dr !== cr) return { error: "Debits and credits must be equal." };
  const { data, error } = await s.supabase.rpc("rpc_save_transaction", {
    p: { type, date, memo: String(fd.get("memo") ?? "").trim() || null, number: String(fd.get("number") ?? "").trim() || null, lines },
  });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/accounting/journal");
  return { ok: true, id: data as string };
}

export async function voidJournal(id: string, reason: string): Promise<Result> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  if (!canWrite(s.role)) return { error: "You can view but not change the books." };
  if (!isId(id)) return { error: "Not found." };
  if (!reason.trim()) return { error: "Say why it is voided." };
  const { error } = await s.supabase.rpc("rpc_void", { p_id: id, p_reason: reason.trim() });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/accounting/journal");
  return { ok: true };
}
