"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isLocked, LOCKED } from "@/lib/project-lock";
import { today } from "@/lib/format";

export type StatusResult = { error?: string; ok?: boolean };

const refresh = (projectId: string) => {
  revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath("/projects");
  revalidatePath("/internal");
  revalidatePath("/pnl");
  revalidatePath("/");
};

/**
 * Mark the work finished, and owe everyone their share of it.
 *
 * The accrual is written the moment the job is done rather than when the
 * client pays, because that is when the money is earned — the months in
 * between are exactly what the internal account exists to show.
 */
export async function markCompleted(_prev: unknown, fd: FormData): Promise<StatusResult> {
  const supabase = await createClient();
  if (await isLocked(supabase, String(fd.get("project_id") ?? ""))) return { error: LOCKED };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const projectId = String(fd.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };
  const on = String(fd.get("date") ?? "").trim() || today();

  const { error: upErr } = await supabase
    .from("projects")
    .update({
      completed_at: new Date(on).toISOString(),
      status: "completed",
      progress_pct: 100,
      actual_end_date: on,
    })
    .eq("id", projectId);
  if (upErr) return { error: upErr.message };

  const { data: shares } = await supabase
    .from("project_profit_split")
    .select("share_name, share_kind, pct, investor_id, pool_member_id, share_amount")
    .eq("project_id", projectId);

  const rows = (shares ?? [])
    .filter((s) => Number(s.share_amount ?? 0) !== 0)
    .map((s) => ({
      project_id: projectId,
      share_name: s.share_name as string,
      share_kind: s.share_kind as string,
      pct_snapshot: s.pct as number,
      investor_id: (s.investor_id as string | null) ?? null,
      pool_member_id: (s.pool_member_id as string | null) ?? null,
      entry_type: "accrual" as const,
      amount: s.share_amount as number,
      entry_date: on,
      source: "completed" as const,
      // the company's share, and the pool's earnings as an investor, go back
      // into the pool; directors choose for themselves later
      disposition:
        (s.share_kind as string) === "company" ||
        ((s.share_kind as string) === "investors" && s.pool_member_id)
          ? "retain"
          : "withdraw",
      note: "Share of profit on completion",
      created_by: user.id,
    }));

  // clear any accruals from a previous completion of this project, so pressing
  // completed again refreshes rather than doubling the amounts owed
  await supabase
    .from("internal_account_entries")
    .delete()
    .eq("project_id", projectId)
    .eq("source", "completed");
  if (rows.length) {
    const { error } = await supabase.from("internal_account_entries").insert(rows);
    if (error) return { error: error.message };
  }

  refresh(projectId);
  return { ok: true };
}

/** Undo a completion, taking its accruals back out. */
export async function unmarkCompleted(_prev: unknown, fd: FormData): Promise<StatusResult> {
  const supabase = await createClient();
  const projectId = String(fd.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };

  const { data: project } = await supabase
    .from("projects")
    .select("payment_received_at")
    .eq("id", projectId)
    .maybeSingle();
  if (project?.payment_received_at) {
    return { error: "Payment is already recorded. Undo that first." };
  }

  await supabase
    .from("internal_account_entries")
    .delete()
    .eq("project_id", projectId)
    .eq("source", "completed");

  const { error } = await supabase
    .from("projects")
    .update({ completed_at: null })
    .eq("id", projectId);
  if (error) return { error: error.message };

  refresh(projectId);
  return { ok: true };
}

/**
 * The money arrived. Every share accrued on completion is settled against it,
 * which clears the balance without erasing that it was ever owed.
 */
export async function markPaymentReceived(_prev: unknown, fd: FormData): Promise<StatusResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const projectId = String(fd.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };
  const on = String(fd.get("date") ?? "").trim() || today();
  const amountRaw = String(fd.get("amount") ?? "").replace(/[^0-9.-]/g, "");
  const amount = amountRaw ? Number(amountRaw) : null;

  const { data: accruals } = await supabase
    .from("internal_account_entries")
    .select("share_name, share_kind, pct_snapshot, investor_id, pool_member_id, disposition, amount")
    .eq("project_id", projectId)
    .eq("source", "completed");

  if (!accruals?.length) {
    return { error: "Mark the work completed first — there is nothing accrued to settle." };
  }

  const { error: upErr } = await supabase
    .from("projects")
    .update({
      payment_received_at: new Date(on).toISOString(),
      payment_received_amount: amount,
    })
    .eq("id", projectId);
  if (upErr) return { error: upErr.message };

  // A private investor is not paid just because the client paid us: what they
  // are owed stays open until a repayment is recorded against it.
  const privateInvestor = (a: { share_kind: unknown; investor_id: unknown; pool_member_id: unknown }) =>
    a.share_kind === "investors" && Boolean(a.investor_id) && !a.pool_member_id;

  const rows = accruals.filter((a) => !privateInvestor(a)).map((a) => ({
    project_id: projectId,
    share_name: a.share_name as string,
    share_kind: a.share_kind as string,
    pct_snapshot: a.pct_snapshot as number | null,
    investor_id: (a.investor_id as string | null) ?? null,
    pool_member_id: (a.pool_member_id as string | null) ?? null,
    disposition: (a.disposition as string) ?? "withdraw",
    entry_type: "settlement" as const,
    // settlements are negative, so a balance stays a plain sum
    amount: -Number(a.amount ?? 0),
    entry_date: on,
    source: "payment_received" as const,
    note: "Settled when the client paid",
    created_by: user.id,
  }));

  await supabase
    .from("internal_account_entries")
    .delete()
    .eq("project_id", projectId)
    .eq("source", "payment_received");
  const { error } = await supabase.from("internal_account_entries").insert(rows);
  if (error) return { error: error.message };

  // Now the money is real, what stays in the business joins the pool: the
  // pool's own earnings as an investor, the company's share, and any director
  // who chose to keep theirs.
  const poolRows = accruals
    .filter((a) => a.pool_member_id && a.disposition === "retain")
    .map((a) => ({
      member_id: a.pool_member_id as string,
      entry_type:
        (a.share_kind as string) === "investors" ? ("profit" as const) : ("contribution" as const),
      amount: Number(a.amount ?? 0),
      project_id: projectId,
      origin: "payment_received",
      entry_date: on,
      note:
        (a.share_kind as string) === "investors"
          ? "Pool's share of investor profit"
          : (a.share_kind as string) === "company"
            ? "Company's retained share"
            : "Director kept their share in the pool",
      created_by: user.id,
    }));

  await supabase
    .from("capital_pool_entries")
    .delete()
    .eq("project_id", projectId)
    .eq("origin", "payment_received");
  if (poolRows.length) {
    const { error: pErr } = await supabase.from("capital_pool_entries").insert(poolRows);
    if (pErr) return { error: pErr.message };
  }

  refresh(projectId);
  revalidatePath("/capital-pool");
  return { ok: true };
}

/** Undo a payment, putting what was owed back on the books. */
export async function unmarkPaymentReceived(_prev: unknown, fd: FormData): Promise<StatusResult> {
  const supabase = await createClient();
  const projectId = String(fd.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };

  await supabase
    .from("internal_account_entries")
    .delete()
    .eq("project_id", projectId)
    .eq("source", "payment_received");
  await supabase
    .from("capital_pool_entries")
    .delete()
    .eq("project_id", projectId)
    .eq("origin", "payment_received");

  const { error } = await supabase
    .from("projects")
    .update({ payment_received_at: null, payment_received_amount: null })
    .eq("id", projectId);
  if (error) return { error: error.message };

  refresh(projectId);
  revalidatePath("/capital-pool");
  return { ok: true };
}

/**
 * A director elects to take their share of this project's profit, or keep it in
 * the company as capital. Applied to the accrual raised on completion, so it
 * only makes sense once the work is done.
 */
export async function setShareDisposition(_prev: unknown, fd: FormData): Promise<StatusResult> {
  const supabase = await createClient();
  if (await isLocked(supabase, String(fd.get("project_id") ?? ""))) return { error: LOCKED };
  const projectId = String(fd.get("project_id") ?? "");
  const shareName = String(fd.get("share_name") ?? "");
  const disposition = String(fd.get("disposition") ?? "");
  if (!projectId || !shareName) return { error: "Missing share." };
  if (disposition !== "withdraw" && disposition !== "retain") {
    return { error: "Choose take or keep." };
  }

  // the choice is made between completion and payment; a paid project is
  // locked above, so it never has to move money already in the pool
  const { error } = await supabase
    .from("internal_account_entries")
    .update({ disposition })
    .eq("project_id", projectId)
    .eq("share_name", shareName)
    .eq("entry_type", "accrual");
  if (error) return { error: error.message };


  revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath("/internal");
  return { ok: true };
}
