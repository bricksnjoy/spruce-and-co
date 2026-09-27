"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AuditResult = { error?: string; ok?: boolean; done?: number };

const refresh = () => {
  revalidatePath("/accounting", "layout");
};

/** Mark an item looked at: fine as it is, or queried with a note. */
export async function markItem(checkKey: string, recordIds: string[], status: "ok" | "query", note: string): Promise<AuditResult> {
  const supabase = await createClient();
  if (!recordIds.length) return { ok: true };
  if (status === "query" && !note.trim()) return { error: "Say what needs looking into." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const rows = recordIds.map((record_id) => ({
    check_key: checkKey,
    record_id,
    status,
    note: note.trim() || null,
    marked_by: user?.id,
    marked_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("audit_marks").upsert(rows, { onConflict: "check_key,record_id" });
  if (error) return { error: error.message };
  refresh();
  return { ok: true, done: rows.length };
}

export async function clearMark(checkKey: string, recordId: string): Promise<AuditResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("audit_marks").delete().eq("check_key", checkKey).eq("record_id", recordId);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

/** Bills marked paid with no amount recorded: record them as paid in full. */
export async function billsPaidInFull(): Promise<AuditResult> {
  const supabase = await createClient();
  const { data: bills, error } = await supabase.from("bills").select("id, total, amount_paid").eq("status", "paid");
  if (error) return { error: error.message };
  const short = (bills ?? []).filter((b) => Number(b.amount_paid) < Number(b.total) - 0.005);
  for (let i = 0; i < short.length; i += 20) {
    const results = await Promise.all(short.slice(i, i + 20).map((b) => supabase.from("bills").update({ amount_paid: b.total }).eq("id", b.id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) return { error: failed.error.message };
  }
  revalidatePath("/", "layout");
  return { ok: true, done: short.length };
}

/** Record that a period's books were reviewed, with what was still open. */
export async function signOff(from: string, to: string, notes: string, openIssues: number, summary: Record<string, number>): Promise<AuditResult> {
  const supabase = await createClient();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { error: "Choose the period's first and last day." };
  if (to < from) return { error: "The period ends before it starts." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("audit_reviews").insert({
    period_start: from,
    period_end: to,
    notes: notes.trim() || null,
    open_issues: openIssues,
    summary,
    reviewed_by: user?.id,
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

export async function deleteSignOff(id: string): Promise<AuditResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("audit_reviews").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: "Only an admin can remove a sign-off." };
  refresh();
  return { ok: true };
}
