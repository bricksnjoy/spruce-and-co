"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";
import { parseStatement } from "@/lib/bank-csv";
import { laariToDb, moneyToDb, toLaari } from "@/lib/money";

export type Result = { error?: string; ok?: boolean; id?: string; note?: string };

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const isDate = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

async function writer() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!canWrite(s.role)) return { error: "You can view but not change the bank records." } as const;
  return { s } as const;
}
const refresh = () => revalidatePath("/banking", "layout");

/** Read a bank statement CSV and bring its lines in; each is matched to the books where it obviously fits. */
export async function importStatement(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const account = text(fd, "account_id");
  const file = fd.get("file");
  if (!isId(account)) return { error: "Choose the account the statement is for." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the statement file (CSV)." };
  if (file.size > 3 * 1024 * 1024) return { error: "That file is larger than 3MB; export a shorter period." };
  let parsed;
  try { parsed = parseStatement(await file.text()); } catch (e) { return { error: e instanceof Error ? e.message : "The file could not be read." }; }
  if (!parsed.lines.length) return { error: "No transactions were found in that file." };
  const lines = parsed.lines.map((l) => ({ date: l.date, description: l.description, amount: l.amount.toFixed(2),
    balance: l.balance === null ? null : l.balance.toFixed(2), fingerprint: l.fingerprint }));
  const { data, error } = await w.s.supabase.rpc("rpc_import_statement", { p_account: account, p_file: file.name, p_lines: lines });
  if (error) return { error: dbMessage(error) };
  const r = data as { added: number; duplicates: number; matched: number };
  refresh();
  return { ok: true, id: account, note: `${r.added} new line${r.added === 1 ? "" : "s"}, ${r.matched} matched to the books automatically${r.duplicates ? `, ${r.duplicates} already imported before` : ""}${parsed.skipped ? `, ${parsed.skipped} row${parsed.skipped === 1 ? "" : "s"} without an amount skipped` : ""}.` };
}

export async function matchLine(lineId: string, journalLineId: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!/^\d+$/.test(journalLineId)) return { error: "Choose the entry to match." };
  const { error } = await w.s.supabase.rpc("rpc_match_line", { p_line: lineId, p_journal_line: Number(journalLineId) });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

export async function unmatchLine(lineId: string, status: "open" | "excluded"): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { error } = await w.s.supabase.rpc("rpc_unmatch_line", { p_line: lineId, p_status: status });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

export async function addFromLine(lineId: string, accountId: string, contactId: string, projectId: string, memo: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(accountId)) return { error: "Choose what it was for." };
  const { data, error } = await w.s.supabase.rpc("rpc_add_from_line", {
    p_line: lineId, p_account: accountId, p_contact: isId(contactId) ? contactId : null, p_project: isId(projectId) ? projectId : null, p_memo: memo.trim() || null,
  });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true, id: data as string };
}

export async function saveRule(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const name = text(fd, "name");
  const account = text(fd, "account_id");
  const direction = text(fd, "direction") ?? "any";
  const min = text(fd, "min_amount"), max = text(fd, "max_amount");
  if (!name) return { error: "Name the rule." };
  if (!isId(account)) return { error: "Choose the account it posts to." };
  if (!["in", "out", "any"].includes(direction)) return { error: "Choose money in, out or either." };
  const minV = min === null ? null : moneyToDb(min), maxV = max === null ? null : moneyToDb(max);
  if ((min !== null && minV === null) || (max !== null && maxV === null)) return { error: "Amounts must be numbers." };
  const pr = text(fd, "priority");
  const { data, error } = await w.s.supabase.from("bank_rules").insert({
    name, contains: text(fd, "contains"), direction, min_amount: minV, max_amount: maxV, account_id: account,
    contact_id: isId(text(fd, "contact_id")) ? text(fd, "contact_id") : null, project_id: isId(text(fd, "project_id")) ? text(fd, "project_id") : null,
    priority: pr && /^\d{1,4}$/.test(pr) ? Number(pr) : 100,
  }).select("id").single();
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true, id: data.id as string };
}

export async function toggleRule(id: string, active: boolean): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { error } = await w.s.supabase.from("bank_rules").update({ active }).eq("id", id);
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

export async function deleteRule(id: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { error } = await w.s.supabase.from("bank_rules").delete().eq("id", id);
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

/** Move money between two of your own accounts. */
export async function transfer(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const from = text(fd, "from"), to = text(fd, "to"), date = text(fd, "date");
  const amount = toLaari(text(fd, "amount"));
  if (!isId(from) || !isId(to)) return { error: "Choose both accounts." };
  if (from === to) return { error: "Choose two different accounts." };
  if (!isDate(date)) return { error: "Enter the date." };
  if (amount === null || amount <= 0n) return { error: "Enter the amount." };
  const { data, error } = await w.s.supabase.rpc("rpc_save_transaction", { p: {
    type: "transfer", date, bank_account_id: from, total_amount: laariToDb(amount), memo: text(fd, "memo") ?? "Transfer",
    reference: text(fd, "reference"), lines: [{ account_id: to, amount: laariToDb(amount) }],
  } });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true, id: data as string };
}

export async function startReconciliation(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const account = text(fd, "account_id"), date = text(fd, "statement_date");
  const ending = moneyToDb(text(fd, "ending_balance"));
  if (!isId(account)) return { error: "No account." };
  if (!isDate(date)) return { error: "Enter the statement date." };
  if (ending === null) return { error: "Enter the statement's ending balance." };
  const { data, error } = await w.s.supabase.rpc("rpc_start_reconciliation", { p_account: account, p_date: date, p_ending: ending });
  if (error) return { error: /reconciliations_one_open|duplicate key/.test(error.message) ? "A reconciliation is already in progress for this account." : dbMessage(error) };
  refresh();
  return { ok: true, id: data as string };
}

export async function setCleared(reconId: string, ids: string[], cleared: boolean): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const nums = ids.filter((x) => /^\d+$/.test(x)).map(Number);
  const { error } = await w.s.supabase.rpc("rpc_set_cleared", { p_recon: reconId, p_lines: nums, p_cleared: cleared });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

export async function finishReconciliation(reconId: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { error } = await w.s.supabase.rpc("rpc_finish_reconciliation", { p_recon: reconId });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

export async function undoReconciliation(reconId: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { error } = await w.s.supabase.rpc("rpc_undo_reconciliation", { p_recon: reconId });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}
