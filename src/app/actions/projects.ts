"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isLocked, LOCKED } from "@/lib/project-lock";
import { moneyToDb, percentToDb } from "@/lib/money";

export type Result = { error?: string; ok?: boolean };

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};

/** An amount as the database's exact decimal string (never a float); blank is 0. */
const amount = (fd: FormData, k: string) => moneyToDb(String(fd.get(k) ?? "").replace(/[^0-9.,-]/g, "")) ?? "0.00";
const percent = (fd: FormData, k: string) => percentToDb(String(fd.get(k) ?? "")) ?? "0";
/** Blank means "use the company default" (Settings → Accounting). */
const recognition = (fd: FormData) => {
  const v = text(fd, "recognition_method");
  return v === "billing" || v === "poc" ? v : null;
};

const int = (fd: FormData, k: string) => {
  const raw = String(fd.get(k) ?? "").replace(/[^0-9-]/g, "");
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

/** end date = start + duration, so the two never drift apart */
function endDate(start: string | null, days: number | null) {
  if (!start || days === null) return null;
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve the customer for a project: an existing customer, or a name typed
 * into the "new customer" box, added on the fly. Clients and customers are one
 * list; the database keeps the project's old client field in step.
 */
async function resolveCustomer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fd: FormData,
): Promise<{ id: string | null; error?: string }> {
  const newName = text(fd, "new_client_name") ?? text(fd, "new_customer_name");
  if (newName) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .contains("kinds", ["customer"])
      .ilike("name", newName.replace(/[%_\\]/g, (m) => `\\${m}`))
      .limit(1);
    if (existing?.length) return { id: existing[0].id };

    const { data, error } = await supabase
      .from("contacts")
      .insert({ name: newName, kinds: ["customer"] })
      .select("id")
      .single();
    if (error) return { id: null, error: `Could not add the customer: ${error.message}` };
    return { id: data.id };
  }
  return { id: text(fd, "customer_id") };
}

export async function createProject(_prev: unknown, fd: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = text(fd, "name");
  if (!name) return { error: "Give the project a name." };

  const customer = await resolveCustomer(supabase, fd);
  if (customer.error) return { error: customer.error };

  const start = text(fd, "start_date");
  const days = int(fd, "duration_days");

  // let the database pick the next code unless one was typed in
  let code = text(fd, "code");
  if (!code) {
    const { data } = await supabase.rpc("next_project_code");
    code = (data as string | null) ?? "SC-001";
  }

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      code,
      name,
      customer_id: customer.id,
      status: text(fd, "status") ?? "in_progress",
      description: text(fd, "description"),
      site_address: text(fd, "site_address"),
      contract_value: amount(fd, "contract_value"),
      gst_amount: amount(fd, "gst_amount"),
      start_date: start,
      duration_days: days,
      end_date: endDate(start, days),
      progress_pct: percent(fd, "progress_pct"),
      recognition_method: recognition(fd),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: `Project code ${code} is already in use.` };
    return { error: error.message };
  }

  revalidatePath("/projects");
  revalidatePath("/pnl");
  revalidatePath("/");
  redirect(`/projects/${project.id}`);
}

export async function updateProject(_prev: unknown, fd: FormData): Promise<Result> {
  const supabase = await createClient();
  if (await isLocked(supabase, String(fd.get("id") ?? ""))) return { error: LOCKED };
  const id = String(fd.get("id") ?? "");
  if (!id) return { error: "Missing project id." };

  const name = text(fd, "name");
  if (!name) return { error: "Give the project a name." };

  const customer = await resolveCustomer(supabase, fd);
  if (customer.error) return { error: customer.error };

  const start = text(fd, "start_date");
  const days = int(fd, "duration_days");

  const { error } = await supabase
    .from("projects")
    .update({
      code: text(fd, "code") ?? undefined,
      name,
      customer_id: customer.id,
      status: text(fd, "status") ?? "in_progress",
      description: text(fd, "description"),
      site_address: text(fd, "site_address"),
      contract_value: amount(fd, "contract_value"),
      gst_amount: amount(fd, "gst_amount"),
      start_date: start,
      duration_days: days,
      end_date: endDate(start, days),
      progress_pct: percent(fd, "progress_pct"),
      recognition_method: recognition(fd),
    })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return { error: "That project code is already in use." };
    return { error: error.message };
  }

  revalidatePath(`/projects/${id}`, "layout");
  revalidatePath("/projects");
  revalidatePath("/pnl");
  revalidatePath("/");
  redirect(`/projects/${id}`);
}

/**
 * Archive a project, or bring it back. Nothing is deleted: its bills,
 * invoices, payments and profit shares stay on the books and in every
 * report; it only leaves the working lists and pickers.
 */
export async function setProjectArchived(id: string, archived: boolean): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error, count } = await supabase
    .from("projects")
    .update({ archived_at: archived ? new Date().toISOString() : null }, { count: "exact" })
    .eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: "You don't have permission to archive projects." };
  revalidatePath("/", "layout");
  return { ok: true };
}
