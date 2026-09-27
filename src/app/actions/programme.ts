"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ProgrammeResult = { error?: string; ok?: boolean };
export type PhaseStatus = "not_started" | "in_progress" | "blocked" | "completed";

const STATUSES: PhaseStatus[] = ["not_started", "in_progress", "blocked", "completed"];
const refresh = (projectId: string) => {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/tasks");
};
const dateOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export interface PhaseInput {
  id?: string;
  project_id: string;
  name: string;
  status: PhaseStatus;
  start_date: string | null;
  end_date: string | null;
  progress_pct: number;
}

/** Add or change a phase. Finishing one sets it to 100%; 100% finishes it. */
export async function savePhase(p: PhaseInput): Promise<ProgrammeResult> {
  const supabase = await createClient();
  const name = p.name?.trim();
  if (!name) return { error: "Name the phase." };
  if (!STATUSES.includes(p.status)) return { error: "Unknown status." };
  const start = dateOrNull(p.start_date);
  const end = dateOrNull(p.end_date);
  if (start && end && end < start) return { error: "It cannot end before it starts." };
  let progress = Math.min(100, Math.max(0, Math.round(Number(p.progress_pct) || 0)));
  let status = p.status;
  if (status === "completed") progress = 100;
  else if (progress === 100) status = "completed";
  else if (progress > 0 && status === "not_started") status = "in_progress";

  const row = { name, status, start_date: start, end_date: end, progress_pct: progress };
  if (p.id) {
    const { error } = await supabase.from("project_phases").update(row).eq("id", p.id);
    if (error) return { error: error.message };
  } else {
    const { count } = await supabase.from("project_phases").select("id", { count: "exact", head: true }).eq("project_id", p.project_id);
    const { error } = await supabase.from("project_phases").insert({ ...row, project_id: p.project_id, sort_order: (count ?? 0) + 1 });
    if (error) return { error: error.message };
  }
  refresh(p.project_id);
  return { ok: true };
}

export async function deletePhase(id: string, projectId: string): Promise<ProgrammeResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("project_phases").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: "Only an admin can delete a phase." };
  refresh(projectId);
  return { ok: true };
}

/** Move a phase up or down the programme. */
export async function movePhase(projectId: string, ids: string[]): Promise<ProgrammeResult> {
  const supabase = await createClient();
  const results = await Promise.all(ids.map((id, i) => supabase.from("project_phases").update({ sort_order: i + 1 }).eq("id", id)));
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };
  refresh(projectId);
  return { ok: true };
}

/** The stages of a typical fit-out, and each one's share of the time. */
const STANDARD: [string, number][] = [
  ["Site preparation & demolition", 0.08],
  ["Masonry & structural works", 0.14],
  ["Plumbing & electrical first fix", 0.12],
  ["Plastering & screeding", 0.1],
  ["Ceiling works", 0.08],
  ["Tiling & flooring", 0.12],
  ["Joinery & cabinets", 0.12],
  ["Painting", 0.1],
  ["Second fix & fittings", 0.08],
  ["Cleaning, snagging & handover", 0.06],
];

/** Start an empty programme from the usual stages, spread over the project's dates. */
export async function applyStandardProgramme(projectId: string): Promise<ProgrammeResult> {
  const supabase = await createClient();
  const [{ data: project }, { count }] = await Promise.all([
    supabase.from("projects").select("start_date, end_date").eq("id", projectId).maybeSingle(),
    supabase.from("project_phases").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);
  if (count) return { error: "This project already has phases." };
  const day = 86_400_000;
  const start = project?.start_date ? new Date(`${project.start_date}T00:00:00Z`) : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const end = project?.end_date ? new Date(`${project.end_date}T00:00:00Z`) : new Date(start.getTime() + 90 * day);
  const span = Math.max(STANDARD.length, Math.round((end.getTime() - start.getTime()) / day));
  let at = 0;
  const rows = STANDARD.map(([name, share], i) => {
    const days = i === STANDARD.length - 1 ? span - at : Math.max(1, Math.round(span * share));
    const s = new Date(start.getTime() + at * day);
    const e = new Date(start.getTime() + (at + days - 1) * day);
    at += days;
    return {
      project_id: projectId,
      name,
      sort_order: i + 1,
      status: "not_started" as PhaseStatus,
      progress_pct: 0,
      start_date: s.toISOString().slice(0, 10),
      end_date: e.toISOString().slice(0, 10),
    };
  });
  const { error } = await supabase.from("project_phases").insert(rows);
  if (error) return { error: error.message };
  refresh(projectId);
  return { ok: true };
}

export interface MilestoneInput {
  id?: string;
  project_id: string;
  phase_id: string | null;
  name: string;
  planned_date: string | null;
  is_payment_milestone: boolean;
  payment_amount: number;
  notes: string;
}

export async function saveMilestone(m: MilestoneInput): Promise<ProgrammeResult> {
  const supabase = await createClient();
  const name = m.name?.trim();
  if (!name) return { error: "Name the milestone." };
  const amount = m.is_payment_milestone ? Math.max(0, Number(m.payment_amount) || 0) : 0;
  if (m.is_payment_milestone && !amount) return { error: "Enter what is due at this milestone." };
  const row = {
    name,
    phase_id: m.phase_id || null,
    planned_date: dateOrNull(m.planned_date),
    is_payment_milestone: Boolean(m.is_payment_milestone),
    payment_amount: amount,
    notes: m.notes?.trim() || null,
  };
  const { error } = m.id
    ? await supabase.from("milestones").update(row).eq("id", m.id)
    : await supabase.from("milestones").insert({ ...row, project_id: m.project_id });
  if (error) return { error: error.message };
  refresh(m.project_id);
  return { ok: true };
}

/** Tick a milestone reached (dated today, unless a date is given) or untick it. */
export async function reachMilestone(id: string, projectId: string, reached: boolean, on?: string): Promise<ProgrammeResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("milestones")
    .update(reached
      ? { status: "completed", actual_date: dateOrNull(on) ?? new Date().toISOString().slice(0, 10) }
      : { status: "not_started", actual_date: null })
    .eq("id", id);
  if (error) return { error: error.message };
  refresh(projectId);
  return { ok: true };
}

export async function deleteMilestone(id: string, projectId: string): Promise<ProgrammeResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("milestones").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: "Only an admin can delete a milestone." };
  refresh(projectId);
  return { ok: true };
}
