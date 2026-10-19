"use server";

import { revalidatePath } from "next/cache";
import { dbMessage, getSession } from "@/server/session";
import { reportByKey } from "@/server/reports";

export type Result = { error?: string; ok?: boolean };

/** Keep a report's filters under a name, for this user. */
export async function saveReport(name: string, report: string, query: string): Promise<Result> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  if (!name.trim()) return { error: "Give it a name." };
  if (!reportByKey(report)) return { error: "No such report." };
  const params = Object.fromEntries(new URLSearchParams(query).entries());
  const { error } = await s.supabase.from("saved_reports").insert({ name: name.trim().slice(0, 80), report, params });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/reports");
  return { ok: true };
}

export async function deleteSavedReport(id: string): Promise<Result> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Not found." };
  const { error } = await s.supabase.from("saved_reports").delete().eq("id", id);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/reports");
  return { ok: true };
}
