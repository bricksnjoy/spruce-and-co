"use server";

import { getSession } from "@/server/session";
import { readSaved, type Saved } from "@/lib/cut-list";

export type CutListSave =
  | { ok: true; at: string }
  | { conflict: true; saved: Saved; at: string }
  | { error: string };

/**
 * Save the person's cut list. `base` is the time of the saved copy this device
 * started from; if another device has saved since, nothing is written and that
 * list comes back instead.
 */
export async function saveCutList(body: string, base: string | null): Promise<CutListSave> {
  const s = await getSession();
  if (!s) return { error: "Signed out. Sign in again to save the list." };
  if (body.length > 200_000) return { error: "The list is too long to save." };
  let saved: Saved | null = null;
  try { saved = readSaved(JSON.parse(body)); } catch { /* not JSON */ }
  if (!saved) return { error: "The list could not be read." };
  const { data, error } = await s.supabase.rpc("rpc_save_cut_list", { p_data: saved, p_base: base });
  if (error) return { error: "The list could not be saved." };
  const r = data as { updated_at: string; conflict?: boolean; data?: unknown };
  if (r.conflict) {
    const theirs = readSaved(r.data);
    // a saved list that cannot be read is replaced rather than offered
    if (!theirs) return saveCutList(body, r.updated_at);
    return { conflict: true, saved: theirs, at: r.updated_at };
  }
  return { ok: true, at: r.updated_at };
}

/** The person's saved list and when it was saved; nothing if they have not saved one. */
export async function loadCutList(): Promise<{ saved: Saved | null; at: string | null }> {
  const s = await getSession();
  if (!s) return { saved: null, at: null };
  const { data } = await s.supabase.from("cut_lists").select("data, updated_at").eq("user_id", s.userId).maybeSingle();
  const saved = data ? readSaved(data.data) : null;
  return { saved, at: saved ? (data!.updated_at as string) : null };
}
