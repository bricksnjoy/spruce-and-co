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

/* ─────────────── tasks ─────────────── */

export interface TaskInput {
  id?: string;
  project_id: string;
  phase_id: string | null;
  title: string;
  due_date: string | null;
  assignee_id: string | null;
  description: string;
}

/** A phase with tasks is as far along as its tasks are done. */
async function syncPhase(supabase: Awaited<ReturnType<typeof createClient>>, phaseId: string | null) {
  if (!phaseId) return;
  const [{ data: tasks }, { data: phase }] = await Promise.all([
    supabase.from("project_tasks").select("status").eq("phase_id", phaseId),
    supabase.from("project_phases").select("status").eq("id", phaseId).maybeSingle(),
  ]);
  if (!tasks?.length || !phase) return;
  const done = tasks.filter((t) => t.status === "completed").length;
  const progress = Math.round((done / tasks.length) * 100);
  const status: PhaseStatus =
    done === tasks.length ? "completed" : phase.status === "blocked" ? "blocked" : done > 0 || tasks.some((t) => t.status === "in_progress") ? "in_progress" : "not_started";
  await supabase.from("project_phases").update({ progress_pct: progress, status }).eq("id", phaseId);
}

export async function saveTask(t: TaskInput): Promise<ProgrammeResult> {
  const supabase = await createClient();
  const title = t.title?.trim();
  if (!title) return { error: "Say what the task is." };
  const row = {
    title,
    phase_id: t.phase_id || null,
    due_date: dateOrNull(t.due_date),
    assignee_id: t.assignee_id || null,
    description: t.description?.trim() || null,
  };
  let before: string | null = null;
  if (t.id) {
    const { data: old } = await supabase.from("project_tasks").select("phase_id").eq("id", t.id).maybeSingle();
    before = old?.phase_id ?? null;
  }
  const { error } = t.id
    ? await supabase.from("project_tasks").update(row).eq("id", t.id)
    : await supabase.from("project_tasks").insert({ ...row, project_id: t.project_id });
  if (error) return { error: error.message };
  await Promise.all([syncPhase(supabase, row.phase_id), before !== row.phase_id ? syncPhase(supabase, before) : null]);
  refresh(t.project_id);
  return { ok: true };
}

/** Tick a task done or not, and move its phase along with it. */
export async function toggleTask(id: string, projectId: string, done: boolean): Promise<ProgrammeResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_tasks")
    .update(done ? { status: "completed", completed_at: new Date().toISOString() } : { status: "not_started", completed_at: null })
    .eq("id", id)
    .select("phase_id")
    .maybeSingle();
  if (error) return { error: error.message };
  await syncPhase(supabase, data?.phase_id ?? null);
  refresh(projectId);
  return { ok: true };
}

export async function deleteTask(id: string, projectId: string): Promise<ProgrammeResult> {
  const supabase = await createClient();
  const { data: old } = await supabase.from("project_tasks").select("phase_id").eq("id", id).maybeSingle();
  const { error, count } = await supabase.from("project_tasks").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: "Only an admin can delete a task." };
  await syncPhase(supabase, old?.phase_id ?? null);
  refresh(projectId);
  return { ok: true };
}
