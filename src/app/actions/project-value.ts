"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";
import { moneyToDb, percentToDb } from "@/lib/money";

export type Result = { error?: string; ok?: boolean };

const CATEGORIES = ["materials", "subcontractors", "labour", "equipment", "freight", "site", "other"];
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const isDate = (v: string | null) => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nonNeg = (v: string | null) => v !== null && !v.startsWith("-");

async function writer() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!canWrite(s.role)) return { error: "You can view but not change projects." } as const;
  return { s } as const;
}
const done = (projectId: string) => { revalidatePath(`/projects/${projectId}`, "layout"); revalidatePath("/projects"); };

/** Add or change a budget line: original budget, revised budget and forecast to complete. */
export async function saveBudgetLine(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const project_id = text(fd, "project_id");
  const id = text(fd, "id");
  const description = text(fd, "description");
  const category = text(fd, "budget_category");
  const budget = moneyToDb(text(fd, "budget_amount"));
  const revisedRaw = text(fd, "revised_amount");
  const revised = revisedRaw === null ? null : moneyToDb(revisedRaw);
  const ftcRaw = text(fd, "forecast_to_complete");
  const ftc = ftcRaw === null ? null : moneyToDb(ftcRaw);
  if (!project_id) return { error: "No project." };
  if (!description) return { error: "Describe the budget line." };
  if (!category || !CATEGORIES.includes(category)) return { error: "Choose the cost category." };
  if (!nonNeg(budget)) return { error: "Enter the budget as an amount of 0 or more." };
  if (revisedRaw !== null && !nonNeg(revised)) return { error: "Enter the revised budget as an amount, or leave it blank." };
  if (ftcRaw !== null && !nonNeg(ftc)) return { error: "Enter the forecast to complete as an amount, or leave it blank." };

  const row = { project_id, description, budget_category: category, budget_amount: budget, revised_amount: revised, forecast_to_complete: ftc };
  const { error } = id
    ? await w.s.supabase.from("budget_lines").update(row).eq("id", id).eq("project_id", project_id)
    : await w.s.supabase.from("budget_lines").insert(row);
  if (error) return { error: dbMessage(error) };
  done(project_id);
  return { ok: true };
}

export async function deleteBudgetLine(projectId: string, id: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { error } = await w.s.supabase.from("budget_lines").delete().eq("id", id).eq("project_id", projectId);
  if (error) return { error: dbMessage(error) };
  done(projectId);
  return { ok: true };
}

/** Raise a variation. It moves the contract value only once approved. */
export async function addVariation(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const project_id = text(fd, "project_id");
  const title = text(fd, "title");
  const amount = moneyToDb(text(fd, "amount"));
  const raised = text(fd, "raised_date");
  if (!project_id) return { error: "No project." };
  if (!title) return { error: "Describe the variation." };
  if (amount === null) return { error: "Enter the amount it changes the contract by (negative for an omission)." };
  if (!isDate(raised)) return { error: "Enter the date it was raised." };
  const days = text(fd, "time_impact_days");
  if (days !== null && !/^-?\d{1,4}$/.test(days)) return { error: "Time impact is a whole number of days." };
  const { error } = await w.s.supabase.from("variations").insert({
    project_id, title, amount, cost_impact: amount, raised_date: raised, status: "submitted",
    description: text(fd, "description"), client_reference: text(fd, "client_reference"),
    time_impact_days: days === null ? 0 : Number(days),
  });
  if (error) return { error: dbMessage(error) };
  done(project_id);
  return { ok: true };
}

/** Approve, reject or withdraw a variation. Approval dates it, and the revised value follows. */
export async function setVariationStatus(projectId: string, id: string, status: "approved" | "rejected" | "cancelled" | "submitted", approvedDate?: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (status === "approved" && !isDate(approvedDate ?? null)) return { error: "Enter the date it was approved." };
  const patch = status === "approved"
    ? { status, approved_date: approvedDate, approved_by: w.s.userId }
    : { status, approved_date: null, approved_by: null };
  const { error } = await w.s.supabase.from("variations").update(patch).eq("id", id).eq("project_id", projectId);
  if (error) return { error: dbMessage(error) };
  done(projectId);
  return { ok: true };
}

/** A progress-billing stage: a percentage of the revised contract, or a fixed amount. */
export async function saveBillingStage(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const project_id = text(fd, "project_id");
  const name = text(fd, "name");
  const basis = text(fd, "basis");
  if (!project_id) return { error: "No project." };
  if (!name) return { error: "Name the stage, e.g. Deposit or Roof complete." };
  if (basis !== "percent" && basis !== "amount") return { error: "Choose percent or amount." };
  const value = basis === "percent" ? percentToDb(text(fd, "value")) : moneyToDb(text(fd, "value"));
  if (value === null || value.startsWith("-") || /^0+(\.0+)?$/.test(value)) return { error: basis === "percent" ? "Enter a percentage above 0." : "Enter an amount above 0." };
  const { data: last } = await w.s.supabase.from("billing_stages").select("sort_order").eq("project_id", project_id).order("sort_order", { ascending: false }).limit(1);
  const { error } = await w.s.supabase.from("billing_stages").insert({
    project_id, name, basis, value, due_event: text(fd, "due_event"), sort_order: (last?.[0]?.sort_order ?? 0) + 1,
  });
  if (error) return { error: dbMessage(error) };
  done(project_id);
  return { ok: true };
}

export async function deleteBillingStage(projectId: string, id: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const { data: st } = await w.s.supabase.from("billing_stages").select("invoice_id").eq("id", id).maybeSingle();
  if (st?.invoice_id) return { error: "This stage has been invoiced, so it stays." };
  const { error } = await w.s.supabase.from("billing_stages").delete().eq("id", id).eq("project_id", projectId);
  if (error) return { error: dbMessage(error) };
  done(projectId);
  return { ok: true };
}

/** Post percentage-of-completion WIP at a period end for every POC project (reversed the next day). */
export async function runWip(_prev: unknown, fd: FormData): Promise<Result & { count?: number }> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const end = text(fd, "period_end");
  if (!isDate(end)) return { error: "Enter the period end date." };
  const { data, error } = await w.s.supabase.rpc("rpc_run_wip", { p_period_end: end });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/projects", "layout");
  return { ok: true, count: Number(data ?? 0) };
}
