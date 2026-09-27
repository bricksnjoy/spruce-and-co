"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { poolPosition } from "@/lib/pool";
import { addMonths, monthLabel, monthStart, monthsCovered, payableNow, planCovers } from "@/lib/salaries";
import { today } from "@/lib/format";

export type SalaryResult = { error?: string; ok?: boolean; paid?: number; skipped?: string[] };

const refresh = () => {
  revalidatePath("/salaries");
  revalidatePath("/people");
  revalidatePath("/capital-pool");
  revalidatePath("/", "layout");
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-MV", { style: "currency", currency: "MVR" }).format(n);

/**
 * Set someone up to draw a monthly amount from a pool member's balance. A fixed
 * term is refused if it would take more than that member holds today, so
 * nobody can be promised money that is not theirs.
 */
export async function createSalaryPlan(_prev: unknown, fd: FormData): Promise<SalaryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const personId = String(fd.get("person_id") ?? "");
  let memberId = String(fd.get("paid_from_member_id") ?? "");
  const monthly = Number(String(fd.get("monthly_amount") ?? "").replace(/[^0-9.]/g, ""));
  const start = monthStart(String(fd.get("start_month") ?? "") || new Date());
  const term = String(fd.get("term") ?? "until_empty");
  const months = term === "fixed" ? Number(fd.get("months") ?? 0) : null;

  if (!personId) return { error: "Choose who is being paid." };
  if (!memberId) return { error: "Choose whose share of the pool pays it." };
  if (!Number.isFinite(monthly) || monthly <= 0) return { error: "Enter the monthly amount." };
  if (term === "fixed" && (!months || months < 1)) return { error: "Enter how many months." };

  const pos = await poolPosition(supabase);

  // employees are paid from company money, whoever set the plan up
  const { data: person } = await supabase
    .from("people")
    .select("role")
    .eq("id", personId)
    .maybeSingle();
  if (person?.role === "employee") {
    const company = pos.members.find((m) => m.kind === "company");
    if (company) memberId = company.id;
  }

  const member = pos.members.find((m) => m.id === memberId);
  if (!member) return { error: "That pool member does not exist." };
  if (member.balance <= 0) {
    return { error: `${member.name} has nothing in the pool to draw a salary from.` };
  }
  if (member.free <= 0) {
    return {
      error: `All of ${member.name}'s ${fmt(member.balance)} is invested in projects not yet paid for, so none of it can be taken as salary yet.`,
    };
  }
  if (months && monthly * months > member.free + 0.001) {
    const most = monthsCovered(member.free, monthly);
    return {
      error: `${member.name} has ${fmt(member.free)} free${
        member.invested > 0 ? ` (${fmt(member.invested)} more is invested in projects)` : ""
      } — at ${fmt(monthly)} a month that covers ${most} month${most === 1 ? "" : "s"} at most.`,
    };
  }

  const { error } = await supabase.from("salary_plans").insert({
    person_id: personId,
    monthly_amount: monthly,
    paid_from_member_id: memberId,
    start_month: start,
    months,
    note: String(fd.get("note") ?? "").trim() || null,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  refresh();
  return { ok: true };
}

/** Pay one plan for one month, drawn from the pool as a withdrawal. */
async function payOne(
  supabase: Awaited<ReturnType<typeof createClient>>,
  planId: string,
  month: string,
  userId: string,
): Promise<{ error?: string; amount?: number }> {
  const { data: plan } = await supabase
    .from("salary_plans")
    .select("id, person_id, monthly_amount, paid_from_member_id, start_month, months, active, people(name)")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return { error: "That salary plan no longer exists." };

  const person = (plan.people as unknown as { name: string } | null)?.name ?? "Salary";
  const monthly = Number(plan.monthly_amount);
  if (!planCovers({ ...plan, monthly_amount: monthly }, month)) {
    return { error: `${person}'s plan does not cover ${monthLabel(month)}.` };
  }

  const { data: already } = await supabase
    .from("salary_payments")
    .select("id")
    .eq("plan_id", planId)
    .eq("month", month)
    .maybeSingle();
  if (already) return { error: `${person} is already paid for ${monthLabel(month)}.` };

  const pos = await poolPosition(supabase);
  const member = pos.members.find((m) => m.id === plan.paid_from_member_id);
  const due = payableNow(monthly, member?.free ?? 0, pos.available, member?.balance ?? 0);
  if (due.amount <= 0) return { error: `${person}: ${due.reason}.` };

  const { data: entry, error: eErr } = await supabase
    .from("capital_pool_entries")
    .insert({
      member_id: plan.paid_from_member_id,
      entry_type: "withdrawal",
      amount: -due.amount,
      origin: "salary",
      entry_date: today(),
      note: `Salary · ${person} · ${monthLabel(month)}`,
      created_by: userId,
    })
    .select("id")
    .single();
  if (eErr) return { error: eErr.message };

  const { error: pErr } = await supabase.from("salary_payments").insert({
    plan_id: planId,
    person_id: plan.person_id,
    month,
    amount: due.amount,
    pool_entry_id: entry.id,
    created_by: userId,
  });
  if (pErr) {
    await supabase.from("capital_pool_entries").delete().eq("id", entry.id);
    return { error: pErr.message };
  }

  // The plan ends when its term is served, or when the share is spent. Money
  // merely invested does not end it — it resumes once those projects are paid.
  const lastOfTerm = plan.months && month >= addMonths(plan.start_month, plan.months - 1);
  const emptied = (member?.balance ?? 0) - due.amount <= 0.001;
  if (lastOfTerm || emptied) {
    await supabase
      .from("salary_plans")
      .update({ active: false, ended_at: new Date().toISOString() })
      .eq("id", planId);
  }

  return { amount: due.amount };
}

export async function paySalary(_prev: unknown, fd: FormData): Promise<SalaryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const r = await payOne(
    supabase,
    String(fd.get("plan_id") ?? ""),
    monthStart(String(fd.get("month") ?? "") || new Date()),
    user.id,
  );
  if (r.error) return { error: r.error };
  refresh();
  return { ok: true, paid: r.amount };
}

/** Pay everyone due this month, one at a time so each sees the pool as it now stands. */
export async function payAllDue(_prev: unknown, fd: FormData): Promise<SalaryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const month = monthStart(String(fd.get("month") ?? "") || new Date());
  const { data: plans } = await supabase
    .from("salary_plans")
    .select("id, active, start_month, months, monthly_amount")
    .eq("active", true);

  let paid = 0;
  const skipped: string[] = [];
  for (const p of plans ?? []) {
    if (!planCovers({ ...p, monthly_amount: Number(p.monthly_amount) }, month)) continue;
    const r = await payOne(supabase, p.id, month, user.id);
    if (r.error) {
      if (!r.error.includes("already paid")) skipped.push(r.error);
    } else paid += r.amount ?? 0;
  }

  refresh();
  return { ok: true, paid, skipped };
}

/** Reverse a payment: the money goes back to the member and the plan resumes. */
export async function undoSalaryPayment(id: string): Promise<SalaryResult> {
  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("salary_payments")
    .select("plan_id, pool_entry_id, slip_path")
    .eq("id", id)
    .maybeSingle();
  if (!payment) return { error: "That payment no longer exists." };

  // an undone payment takes its slip with it
  if (payment.slip_path) await supabase.storage.from("slips").remove([payment.slip_path]);

  if (payment.pool_entry_id) {
    await supabase.from("capital_pool_entries").delete().eq("id", payment.pool_entry_id);
  }
  await supabase.from("salary_payments").delete().eq("id", id);
  await supabase.from("salary_plans").update({ active: true, ended_at: null }).eq("id", payment.plan_id);

  refresh();
  return { ok: true };
}

/** Stop a plan early. One that has never paid out is simply removed. */
export async function stopSalaryPlan(id: string): Promise<SalaryResult> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("salary_payments")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", id);

  const { error } = count
    ? await supabase
        .from("salary_plans")
        .update({ active: false, ended_at: new Date().toISOString() })
        .eq("id", id)
    : await supabase.from("salary_plans").delete().eq("id", id);
  if (error) return { error: error.message };

  refresh();
  return { ok: true };
}

const SLIP_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

/** Attach — or replace — the slip showing a salary payment went out. */
export async function uploadSlip(_prev: unknown, fd: FormData): Promise<SalaryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const paymentId = String(fd.get("payment_id") ?? "");
  const file = fd.get("slip");
  if (!paymentId) return { error: "Missing payment." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo of the slip." };
  if (file.size > 4 * 1024 * 1024) {
    return { error: "That file is larger than 4MB — a photo of the slip is smaller than a scanned PDF." };
  }
  if (file.type && !SLIP_TYPES.includes(file.type)) {
    return { error: "Upload a photo (JPG, PNG, WebP) or a PDF." };
  }

  const { data: payment } = await supabase
    .from("salary_payments")
    .select("id, slip_path")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return { error: "That payment no longer exists." };

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${paymentId}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("slips")
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "image/jpeg",
    });
  if (upErr) return { error: `Could not save the slip: ${upErr.message}` };

  const { error } = await supabase
    .from("salary_payments")
    .update({ slip_path: path, slip_uploaded_at: new Date().toISOString() })
    .eq("id", paymentId);
  if (error) {
    await supabase.storage.from("slips").remove([path]);
    return { error: error.message };
  }

  // the slip it replaces is no longer referenced by anything
  if (payment.slip_path) await supabase.storage.from("slips").remove([payment.slip_path]);

  revalidatePath("/salaries");
  revalidatePath("/people", "layout");
  return { ok: true };
}

export async function removeSlip(paymentId: string): Promise<SalaryResult> {
  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("salary_payments")
    .select("slip_path")
    .eq("id", paymentId)
    .maybeSingle();
  if (payment?.slip_path) await supabase.storage.from("slips").remove([payment.slip_path]);
  await supabase
    .from("salary_payments")
    .update({ slip_path: null, slip_uploaded_at: null })
    .eq("id", paymentId);
  revalidatePath("/salaries");
  return { ok: true };
}
