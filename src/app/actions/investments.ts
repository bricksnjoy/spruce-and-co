"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isLocked, projectOf, LOCKED } from "@/lib/project-lock";
import { poolPosition, ratioSnapshot } from "@/lib/pool";
import { today } from "@/lib/format";

export type InvestmentResult = { error?: string; ok?: boolean };

const number = (fd: FormData, k: string) => {
  const n = Number(String(fd.get(k) ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};

const refresh = (projectId: string) => {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/financing");
  revalidatePath("/investors");
};

/**
 * Record what an investor put into a project. It is stored as a financing
 * source — the same rows the repayment split reads — so an investment is never
 * a second copy that can drift from the financing figures.
 *
 * The investor is either picked from the directory, or created here in the same
 * step and then linked.
 */
export async function addInvestment(_prev: unknown, fd: FormData): Promise<InvestmentResult> {
  const supabase = await createClient();
  if (await isLocked(supabase, String(fd.get("project_id") ?? ""))) return { error: LOCKED };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const projectId = String(fd.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };

  const amount = number(fd, "amount");
  if (amount <= 0) return { error: "Enter the amount invested." };

  let investorId = String(fd.get("investor_id") ?? "").trim() || null;
  const newName = text(fd, "new_name");

  // create-and-link in one action when the investor is not on file yet
  if (!investorId && newName) {
    const { data: existing } = await supabase
      .from("investors")
      .select("id")
      .ilike("name", newName)
      .maybeSingle();
    if (existing) {
      investorId = existing.id;
    } else {
      const { data, error } = await supabase
        .from("investors")
        .insert({
          name: newName,
          phone: text(fd, "new_phone"),
          email: text(fd, "new_email"),
          status: "active",
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      investorId = data.id;
    }
  }

  if (!investorId) return { error: "Pick an investor or add a new one." };

  const { data: investor } = await supabase
    .from("investors")
    .select("name")
    .eq("id", investorId)
    .single();

  const { count } = await supabase
    .from("project_financing_sources")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { error } = await supabase.from("project_financing_sources").insert({
    project_id: projectId,
    name: investor?.name ?? "Investor",
    source_type: "investor",
    investor_id: investorId,
    amount,
    funded_on: text(fd, "funded_on") ?? today(),
    sort_order: (count ?? 0) + 1,
  });
  if (error) return { error: error.message };

  refresh(projectId);
  return { ok: true };
}

/**
 * Money the capital pool puts into a project. To the project it is an investor
 * like any other, so it takes its share of the investors' profit by what it put
 * in. The pool's make-up is recorded at this moment, because that is the ratio
 * its members earn on — not whatever the pool looks like when the client pays.
 */
export async function addReinvestment(_prev: unknown, fd: FormData): Promise<InvestmentResult> {
  const supabase = await createClient();
  if (await isLocked(supabase, String(fd.get("project_id") ?? ""))) return { error: LOCKED };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const projectId = String(fd.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };
  const amount = number(fd, "amount");
  if (amount <= 0) return { error: "Enter the amount reinvested." };

  const pos = await poolPosition(supabase);
  if (pos.total <= 0) {
    return { error: "The capital pool is empty. Record the members' contributions first." };
  }
  if (amount > pos.available + 0.001) {
    return {
      error: `Only ${pos.available.toFixed(2)} is free in the pool — the rest is reinvested in projects not yet paid for.`,
    };
  }

  const { count } = await supabase
    .from("project_financing_sources")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { data: source, error } = await supabase
    .from("project_financing_sources")
    .insert({
      project_id: projectId,
      name: "Capital Pool",
      source_type: "capital_pool",
      amount,
      funded_on: text(fd, "funded_on") ?? today(),
      sort_order: (count ?? 0) + 1,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const snapshot = ratioSnapshot(pos.members).map((r, i) => ({
    ...r,
    source_id: source.id,
    sort_order: i + 1,
  }));
  const { error: sErr } = await supabase.from("capital_pool_contributions").insert(snapshot);
  if (sErr) return { error: sErr.message };

  refresh(projectId);
  revalidatePath("/capital-pool");
  return { ok: true };
}

export async function deleteInvestment(id: string, projectId: string): Promise<void> {
  const supabase = await createClient();
  if (await isLocked(supabase, await projectOf(supabase, "project_financing_sources", id))) return;
  await supabase.from("project_financing_sources").delete().eq("id", id);
  refresh(projectId);
}
