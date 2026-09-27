"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isLocked, LOCKED } from "@/lib/project-lock";

export type Result = { error?: string; ok?: boolean };

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};

const number = (fd: FormData, k: string) => {
  const raw = String(fd.get(k) ?? "").replace(/[^0-9.-]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
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
 * Resolve the client for a project: either an existing id, or a name typed
 * into the "new client" box, which is created on the fly.
 */
async function resolveClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fd: FormData,
): Promise<{ id: string | null; error?: string }> {
  const newName = text(fd, "new_client_name");
  if (newName) {
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .ilike("name", newName)
      .maybeSingle();
    if (existing) return { id: existing.id };

    const { data, error } = await supabase
      .from("clients")
      .insert({ name: newName, type: "company", is_active: true })
      .select("id")
      .single();
    if (error) return { id: null, error: `Could not add the client: ${error.message}` };
    return { id: data.id };
  }
  return { id: text(fd, "client_id") };
}

export async function createProject(_prev: unknown, fd: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = text(fd, "name");
  if (!name) return { error: "Give the project a name." };

  const client = await resolveClient(supabase, fd);
  if (client.error) return { error: client.error };

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
      client_id: client.id,
      status: text(fd, "status") ?? "in_progress",
      description: text(fd, "description"),
      site_address: text(fd, "site_address"),
      contract_value: number(fd, "contract_value"),
      gst_amount: number(fd, "gst_amount"),
      start_date: start,
      duration_days: days,
      end_date: endDate(start, days),
      progress_pct: number(fd, "progress_pct"),
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

  const client = await resolveClient(supabase, fd);
  if (client.error) return { error: client.error };

  const start = text(fd, "start_date");
  const days = int(fd, "duration_days");

  const { error } = await supabase
    .from("projects")
    .update({
      code: text(fd, "code") ?? undefined,
      name,
      client_id: client.id,
      status: text(fd, "status") ?? "in_progress",
      description: text(fd, "description"),
      site_address: text(fd, "site_address"),
      contract_value: number(fd, "contract_value"),
      gst_amount: number(fd, "gst_amount"),
      start_date: start,
      duration_days: days,
      end_date: endDate(start, days),
      progress_pct: number(fd, "progress_pct"),
    })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return { error: "That project code is already in use." };
    return { error: error.message };
  }

  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  revalidatePath("/pnl");
  revalidatePath("/");
  redirect(`/projects/${id}`);
}

/**
 * Delete a project and everything that only exists for it (phases, tasks,
 * variations, budget, financing). Refused while money has been settled
 * against it — invoices, profit shares, pool entries or investor repayments —
 * since deleting would leave those figures hanging. Its bills are deleted too
 * when asked; otherwise they are kept as general costs. Quotations and
 * estimates are kept, unlinked. Everything removed stays in the change log.
 */
export async function deleteProject(id: string, withBills: boolean): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return { error: "Only an admin can delete a project." };
  if (await isLocked(supabase, id)) return { error: "This project is completed and paid. Undo the payment first if it really has to go." };

  const count = (table: string) =>
    supabase.from(table).select("id", { count: "exact", head: true }).eq("project_id", id).then((r) => r.count ?? 0);
  const [invoices, shares, pool, repayments] = await Promise.all([
    count("invoices"),
    count("internal_account_entries"),
    count("capital_pool_entries"),
    count("investor_repayments"),
  ]);
  const blocking = [
    invoices && `${invoices} invoice${invoices > 1 ? "s" : ""}`,
    shares && `${shares} profit share entr${shares > 1 ? "ies" : "y"}`,
    pool && `${pool} capital pool entr${pool > 1 ? "ies" : "y"}`,
    repayments && `${repayments} investor repayment${repayments > 1 ? "s" : ""}`,
  ].filter(Boolean);
  if (blocking.length) return { error: `It still has ${blocking.join(", ")}. Remove or move those first.` };

  if (withBills) {
    const { error } = await supabase.from("bills").delete().eq("project_id", id);
    if (error) return { error: `Could not delete its bills: ${error.message}` };
  }
  const { error, count: gone } = await supabase.from("projects").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!gone) return { error: "The project was not deleted. Only an admin can delete a project." };

  revalidatePath("/", "layout");
  redirect("/projects");
}
