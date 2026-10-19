"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isLocked, projectOf, LOCKED } from "@/lib/project-lock";

export type FinancingResult = { error?: string; ok?: boolean; id?: string };

export type SourceType = "external_loan" | "capital_pool";

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const number = (fd: FormData, k: string) => {
  const n = Number(String(fd.get(k) ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const refresh = (projectId: string) => {
  revalidatePath("/financing");
  revalidatePath(`/projects/${projectId}`, "layout");
};

/**
 * Add a financing source. A capital-pool source also carries who is in the
 * pool and in what ratio — set per project, because the pool is shared
 * differently from one job to the next.
 */
export async function addFinancingSource(_prev: unknown, fd: FormData): Promise<FinancingResult> {
  const supabase = await createClient();
  if (await isLocked(supabase, String(fd.get("project_id") ?? ""))) return { error: LOCKED };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const projectId = String(fd.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };
  const name = text(fd, "name");
  if (!name) return { error: "Name the financing source." };

  const type = (String(fd.get("source_type") ?? "external_loan") as SourceType) ?? "external_loan";
  const amount = number(fd, "amount");
  if (amount <= 0) return { error: "Enter the amount contributed." };

  // the pool's members and their ratios, if this is a capital-pool source
  const poolCount = Number(fd.get("pool_count") ?? 0);
  const pool: { contributor_name: string; ratio: number; sort_order: number }[] = [];
  if (type === "capital_pool") {
    for (let i = 0; i < poolCount; i++) {
      const cn = String(fd.get(`pool_name_${i}`) ?? "").trim();
      if (!cn) continue;
      const r = Number(String(fd.get(`pool_ratio_${i}`) ?? "0").replace(/[^0-9.]/g, ""));
      pool.push({ contributor_name: cn, ratio: Number.isFinite(r) ? r : 0, sort_order: i + 1 });
    }
    if (pool.length === 0) return { error: "Add at least one person to the capital pool." };
    const total = pool.reduce((s, p) => s + p.ratio, 0);
    if (Math.abs(total - 100) > 0.001) {
      return { error: `The pool ratios add up to ${total.toFixed(2)}%. They have to make 100%.` };
    }
  }

  const { count } = await supabase
    .from("project_financing_sources")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { data: source, error } = await supabase
    .from("project_financing_sources")
    .insert({
      project_id: projectId,
      name,
      source_type: type,
      amount,
      sort_order: (count ?? 0) + 1,
      note: text(fd, "note"),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (pool.length) {
    const { error: pErr } = await supabase
      .from("capital_pool_contributions")
      .insert(pool.map((p) => ({ ...p, source_id: source.id })));
    if (pErr) return { error: pErr.message };
  }

  refresh(projectId);
  return { ok: true, id: source.id };
}

export async function updateFinancingSource(_prev: unknown, fd: FormData): Promise<FinancingResult> {
  const supabase = await createClient();
  if (await isLocked(supabase, await projectOf(supabase, "project_financing_sources", String(fd.get("id") ?? "")))) return { error: LOCKED };
  const id = String(fd.get("id") ?? "");
  const projectId = String(fd.get("project_id") ?? "");
  if (!id) return { error: "Missing source." };

  const name = text(fd, "name");
  if (!name) return { error: "Name the financing source." };
  const type = (String(fd.get("source_type") ?? "external_loan") as SourceType) ?? "external_loan";
  const amount = number(fd, "amount");
  if (amount <= 0) return { error: "Enter the amount contributed." };

  const pool: { contributor_name: string; ratio: number; sort_order: number }[] = [];
  const poolCount = Number(fd.get("pool_count") ?? 0);
  if (type === "capital_pool") {
    for (let i = 0; i < poolCount; i++) {
      const cn = String(fd.get(`pool_name_${i}`) ?? "").trim();
      if (!cn) continue;
      const r = Number(String(fd.get(`pool_ratio_${i}`) ?? "0").replace(/[^0-9.]/g, ""));
      pool.push({ contributor_name: cn, ratio: Number.isFinite(r) ? r : 0, sort_order: i + 1 });
    }
    if (pool.length === 0) return { error: "Add at least one person to the capital pool." };
    const total = pool.reduce((s, p) => s + p.ratio, 0);
    if (Math.abs(total - 100) > 0.001) {
      return { error: `The pool ratios add up to ${total.toFixed(2)}%. They have to make 100%.` };
    }
  }

  const { error } = await supabase
    .from("project_financing_sources")
    .update({ name, source_type: type, amount, note: text(fd, "note") })
    .eq("id", id);
  if (error) return { error: error.message };

  // rewrite the pool wholesale — ratios only make sense as a set
  await supabase.from("capital_pool_contributions").delete().eq("source_id", id);
  if (pool.length) {
    await supabase
      .from("capital_pool_contributions")
      .insert(pool.map((p) => ({ ...p, source_id: id })));
  }

  refresh(projectId);
  return { ok: true };
}

export async function deleteFinancingSource(id: string, projectId: string): Promise<void> {
  const supabase = await createClient();
  if (await isLocked(supabase, await projectOf(supabase, "project_financing_sources", id))) return;
  await supabase.from("project_financing_sources").delete().eq("id", id);
  refresh(projectId);
}

/** The share of profit that repays financiers, set per project. */
export async function setRepayPct(_prev: unknown, fd: FormData): Promise<FinancingResult> {
  const supabase = await createClient();
  if (await isLocked(supabase, String(fd.get("project_id") ?? ""))) return { error: LOCKED };
  const projectId = String(fd.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };
  const pct = number(fd, "financing_repay_pct");
  if (pct < 0 || pct > 100) return { error: "The percentage has to be between 0 and 100." };

  const { error } = await supabase
    .from("projects")
    .update({ financing_repay_pct: pct })
    .eq("id", projectId);
  if (error) return { error: error.message };

  refresh(projectId);
  return { ok: true };
}
