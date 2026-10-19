"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";
import { moneyToDb, percentToDb } from "@/lib/money";

export type Result = { error?: string; ok?: boolean; id?: string };

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function writer() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!canWrite(s.role)) return { error: "You can view but not change financing." } as const;
  return { s } as const;
}
const refresh = () => {
  revalidatePath("/partners", "layout");
  revalidatePath("/projects", "layout");
};

/** Money in for a project: a loan from an external lender or a Capital Pool contribution (§5). */
export async function recordFinancing(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const type = text(fd, "type"), project = text(fd, "project_id"), contact = text(fd, "contact_id"), bank = text(fd, "bank_id"), date = text(fd, "date");
  if (type !== "loan_receipt" && type !== "capital_contribution") return { error: "Choose where the money came from." };
  if (!isId(project)) return { error: "Choose the project." };
  if (!isId(contact)) return { error: type === "loan_receipt" ? "Choose the lender." : "Choose the Capital Pool member." };
  if (!isId(bank)) return { error: "Choose the account it was paid into." };
  if (!isDate(date)) return { error: "Enter the date it was received." };
  const amount = moneyToDb(text(fd, "amount"));
  if (amount === null || Number(amount) <= 0) return { error: "Enter the amount received." };
  const { data, error } = await w.s.supabase.rpc("rpc_save_transaction", {
    p: { type, date, contact_id: contact, project_id: project, bank_account_id: bank, total_amount: amount, reference: text(fd, "reference"), memo: text(fd, "memo") },
  });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true, id: data as string };
}

/** Complete a project and post its profit split, after the preview is confirmed (§6). */
export async function completeProject(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const project = text(fd, "project_id"), date = text(fd, "date");
  if (!isId(project)) return { error: "No project." };
  if (!isDate(date)) return { error: "Enter the completion date." };
  if (fd.get("confirm") !== "on") return { error: "Tick the box to confirm the split." };
  const { data, error } = await w.s.supabase.rpc("rpc_complete_project", { p_project: project, p_date: date });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true, id: data as string };
}

/**
 * Pay one person: one line per project and component with an amount
 * (fields named amt:<project id>:<component>). An admin's payout is paid at
 * once; anyone else's waits for an admin's approval.
 */
export async function savePayout(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const contact = text(fd, "contact_id"), bank = text(fd, "bank_id"), date = text(fd, "date");
  if (!isId(contact)) return { error: "No one to pay." };
  if (!isId(bank)) return { error: "Choose the account it is paid from." };
  if (!isDate(date)) return { error: "Enter the payment date." };
  const lines: { project_id: string; component: string; amount: string }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = /^amt:([0-9a-f-]{36}):(principal|financing_return|profit_share)$/i.exec(k);
    if (!m || String(v).trim() === "") continue;
    const amount = moneyToDb(String(v));
    if (amount === null) return { error: "Each amount must be a number." };
    if (Number(amount) === 0) continue;
    if (Number(amount) < 0) return { error: "Amounts paid cannot be negative." };
    lines.push({ project_id: m[1], component: m[2], amount });
  }
  if (!lines.length) return { error: "Enter at least one amount to pay." };
  const { data, error } = await w.s.supabase.rpc("rpc_save_payout", {
    p: { date, contact_id: contact, bank_account_id: bank, reference: text(fd, "reference"), memo: text(fd, "memo"), lines },
  });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true, id: data as string };
}

export async function approvePayout(id: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(id)) return { error: "No payout." };
  const { error } = await w.s.supabase.rpc("rpc_approve_payout", { p_id: id });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

/** A payout that is not approved is voided, with the reason kept. */
export async function rejectPayout(id: string, reason: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(id)) return { error: "No payout." };
  if (!reason.trim()) return { error: "Say why it is not approved." };
  const { error } = await w.s.supabase.rpc("rpc_void", { p_id: id, p_reason: reason.trim() });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

/** A new profit-share scheme version (fields pct:pool, pct:company, pct:<partner id>). */
export async function saveScheme(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const name = text(fd, "name"), from = text(fd, "effective_from");
  if (!name) return { error: "Name the scheme." };
  if (!isDate(from)) return { error: "Enter the date it starts." };
  const allocations: { party_type: string; contact_id?: string; percent: string }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = /^pct:(pool|company|[0-9a-f-]{36})$/i.exec(k);
    if (!m || String(v).trim() === "") continue;
    const percent = percentToDb(String(v));
    if (percent === null) return { error: "Each share must be a percentage." };
    if (Number(percent) === 0) continue;
    allocations.push(m[1] === "pool" ? { party_type: "financing_pool", percent }
      : m[1] === "company" ? { party_type: "company", percent } : { party_type: "person", contact_id: m[1], percent });
  }
  const { data, error } = await w.s.supabase.rpc("rpc_save_scheme", { p: { name, effective_from: from, allocations } });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/settings/profit-share");
  refresh();
  return { ok: true, id: data as string };
}

export async function deleteScheme(id: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(id)) return { error: "No scheme." };
  const { error } = await w.s.supabase.rpc("rpc_delete_scheme", { p_id: id });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/settings/profit-share");
  refresh();
  return { ok: true };
}
