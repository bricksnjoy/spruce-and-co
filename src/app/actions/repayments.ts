"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/format";

export type RepaymentResult = { error?: string; ok?: boolean };

const fmt = (n: number) =>
  new Intl.NumberFormat("en-MV", { style: "currency", currency: "MVR" }).format(n);

const refresh = (projectId: string, investorId: string) => {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/investors/${investorId}`);
  revalidatePath("/investors");
  revalidatePath("/internal");
  revalidatePath("/", "layout");
};

/**
 * Pay a private investor back — their capital, their profit, or both at once.
 * Neither can exceed what is still owed of it, so a slip of the keyboard cannot
 * leave an investor showing as overpaid. Allowed on a locked project, since a
 * project being paid for is usually when its investors are paid back.
 */
export async function recordRepayment(_prev: unknown, fd: FormData): Promise<RepaymentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const investorId = String(fd.get("investor_id") ?? "");
  const projectId = String(fd.get("project_id") ?? "");
  const paidOn = String(fd.get("paid_on") ?? "").trim() || today();
  const note = String(fd.get("note") ?? "").trim() || null;
  const amt = (k: string) => {
    const n = Number(String(fd.get(k) ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  };
  const capital = amt("capital");
  const profit = amt("profit");

  if (!investorId || !projectId) return { error: "Missing investor or project." };
  if (!capital && !profit) return { error: "Enter what is being paid back." };

  const { data: bal } = await supabase
    .from("investor_balances")
    .select("investor_name, capital_owed, profit_owed")
    .eq("investor_id", investorId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!bal) return { error: "Nothing is owed to this investor on this project." };

  if (capital > Number(bal.capital_owed) + 0.001) {
    return { error: `Only ${fmt(Number(bal.capital_owed))} of their capital is still owed.` };
  }
  if (profit > Number(bal.profit_owed) + 0.001) {
    return {
      error:
        Number(bal.profit_owed) > 0
          ? `Only ${fmt(Number(bal.profit_owed))} of their profit is still owed.`
          : "No profit is owed yet — it becomes due when the project is completed.",
    };
  }

  if (capital) {
    const { error } = await supabase.from("investor_repayments").insert({
      investor_id: investorId,
      project_id: projectId,
      kind: "principal",
      amount: capital,
      paid_on: paidOn,
      note,
      created_by: user.id,
    });
    if (error) return { error: error.message };
  }

  if (profit) {
    // the profit share sits in the internal account as owed; paying it settles it
    const { data: accrual } = await supabase
      .from("internal_account_entries")
      .select("share_name")
      .eq("project_id", projectId)
      .eq("investor_id", investorId)
      .eq("entry_type", "accrual")
      .is("pool_member_id", null)
      .maybeSingle();

    const { data: entry, error: eErr } = await supabase
      .from("internal_account_entries")
      .insert({
        project_id: projectId,
        share_name: accrual?.share_name ?? bal.investor_name,
        share_kind: "investors",
        investor_id: investorId,
        entry_type: "settlement",
        amount: -profit,
        entry_date: paidOn,
        source: "manual",
        note: "Profit paid to investor",
        created_by: user.id,
      })
      .select("id")
      .single();
    if (eErr) return { error: eErr.message };

    const { error } = await supabase.from("investor_repayments").insert({
      investor_id: investorId,
      project_id: projectId,
      kind: "profit",
      amount: profit,
      paid_on: paidOn,
      note,
      internal_entry_id: entry.id,
      created_by: user.id,
    });
    if (error) {
      await supabase.from("internal_account_entries").delete().eq("id", entry.id);
      return { error: error.message };
    }
  }

  refresh(projectId, investorId);
  return { ok: true };
}

/** Undo a repayment recorded in error; what it settled becomes owed again. */
export async function deleteRepayment(id: string): Promise<RepaymentResult> {
  const supabase = await createClient();
  const { data: r } = await supabase
    .from("investor_repayments")
    .select("project_id, investor_id, internal_entry_id")
    .eq("id", id)
    .maybeSingle();
  if (!r) return { error: "That repayment no longer exists." };

  await supabase.from("investor_repayments").delete().eq("id", id);
  if (r.internal_entry_id) {
    await supabase.from("internal_account_entries").delete().eq("id", r.internal_entry_id);
  }

  refresh(r.project_id, r.investor_id);
  return { ok: true };
}

/**
 * Tick an investor off as paid on a project — a yes/no record, with no amount
 * attached. Their profit share, if it has been worked out, is cleared from the
 * internal account so it stops showing as owed.
 */
export async function markInvestorPaid(projectId: string, investorId: string): Promise<RepaymentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: accrual } = await supabase
    .from("internal_account_entries")
    .select("share_name, amount")
    .eq("project_id", projectId)
    .eq("investor_id", investorId)
    .eq("entry_type", "accrual")
    .is("pool_member_id", null)
    .maybeSingle();

  let entryId: string | null = null;
  if (accrual && Number(accrual.amount) > 0) {
    const { data: entry, error } = await supabase
      .from("internal_account_entries")
      .insert({
        project_id: projectId,
        share_name: accrual.share_name,
        share_kind: "investors",
        investor_id: investorId,
        entry_type: "settlement",
        amount: -Number(accrual.amount),
        entry_date: today(),
        source: "manual",
        note: "Investor marked as paid",
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    entryId = entry.id;
  }

  const { error } = await supabase.from("investor_paid_marks").insert({
    project_id: projectId,
    investor_id: investorId,
    internal_entry_id: entryId,
    marked_by: user.id,
  });
  if (error) {
    if (entryId) await supabase.from("internal_account_entries").delete().eq("id", entryId);
    // already ticked off by someone else — nothing more to do
    if (error.code !== "23505") return { error: error.message };
  }

  refresh(projectId, investorId);
  return { ok: true };
}

/** Take the tick back off: they show as not yet paid again. */
export async function unmarkInvestorPaid(projectId: string, investorId: string): Promise<RepaymentResult> {
  const supabase = await createClient();
  const { data: mark } = await supabase
    .from("investor_paid_marks")
    .select("internal_entry_id")
    .eq("project_id", projectId)
    .eq("investor_id", investorId)
    .maybeSingle();
  if (!mark) return { ok: true };

  await supabase
    .from("investor_paid_marks")
    .delete()
    .eq("project_id", projectId)
    .eq("investor_id", investorId);
  if (mark.internal_entry_id) {
    await supabase.from("internal_account_entries").delete().eq("id", mark.internal_entry_id);
  }

  refresh(projectId, investorId);
  return { ok: true };
}
