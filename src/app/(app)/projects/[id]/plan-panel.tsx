"use client";

import { useState, useTransition } from "react";
import {
  applyStandardProgramme,
  deleteMilestone,
  deletePhase,
  deleteTask,
  movePhase,
  reachMilestone,
  saveMilestone,
  savePhase,
  saveTask,
  toggleTask,
  type PhaseInput,
  type PhaseStatus,
  type ProgrammeResult,
  type TaskInput,
} from "@/app/actions/programme";
import { money, date } from "@/lib/format";

export interface PhaseRow {
  id: string;
  name: string;
  status: PhaseStatus;
  start_date: string | null;
  end_date: string | null;
  progress_pct: number;
}

export interface MilestoneRow {
  id: string;
  name: string;
  phase_id: string | null;
  planned_date: string | null;
  actual_date: string | null;
  status: PhaseStatus;
  is_payment_milestone: boolean;
  payment_amount: number;
  notes: string | null;
}

export interface TaskRow {
  id: string;
  title: string;
  phase_id: string | null;
  status: PhaseStatus;
  due_date: string | null;
  assignee_id: string | null;
  description: string | null;
}

export interface Person {
  id: string;
  name: string;
}

const input =
  "w-full rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 text-sm outline-none focus:border-[var(--brand)]";
const tiny = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]";
const STATUS: Record<PhaseStatus, { label: string; bar: string; chip: string }> = {
  not_started: { label: "Not started", bar: "#cbd3de", chip: "bg-slate-100 text-slate-700" },
  in_progress: { label: "In progress", bar: "#415a77", chip: "bg-blue-50 text-blue-800" },
  blocked: { label: "Blocked", bar: "#d97706", chip: "bg-amber-50 text-amber-800" },
  completed: { label: "Done", bar: "#15803d", chip: "bg-emerald-50 text-emerald-800" },
};
const DAY = 86_400_000;
const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

/** Runs a server action, keeping its error to show. */
function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ProgrammeResult>, then?: () => void) =>
    start(async () => {
      const r = await fn();
      setError(r.error ?? null);
      if (!r.error) then?.();
    });
  return { pending, error, run };
}

/** How far along the work is, weighted by each phase's length, and how far it should be by today. */
export function programmeProgress(phases: PhaseRow[]) {
  const len = (p: PhaseRow) => (p.start_date && p.end_date ? Math.max(1, daysBetween(p.start_date, p.end_date) + 1) : 1);
  const total = phases.reduce((s, p) => s + len(p), 0) || 1;
  const done = phases.reduce((s, p) => s + (len(p) * Number(p.progress_pct || 0)) / 100, 0);
  const t = today();
  const due = phases.reduce((s, p) => {
    if (!p.start_date || !p.end_date || t < p.start_date) return s;
    if (t > p.end_date) return s + len(p);
    return s + daysBetween(p.start_date, t) + 1;
  }, 0);
  return { actual: Math.round((done / total) * 100), expected: Math.round((due / total) * 100) };
}

/** "in 3 days", "2 days late", "due today" */
function dueIn(d: string | null, done: boolean, doneOn?: string | null) {
  if (done) return { text: doneOn ? `done ${date(doneOn)}` : "done", tone: "text-emerald-700" };
  if (!d) return { text: "", tone: "text-[var(--muted)]" };
  const n = daysBetween(today(), d);
  if (n < 0) return { text: `${-n} day${n === -1 ? "" : "s"} late`, tone: "font-medium text-red-700" };
  if (n === 0) return { text: "due today", tone: "font-medium text-amber-700" };
  return { text: `in ${n} day${n === 1 ? "" : "s"}`, tone: n <= 7 ? "text-amber-700" : "text-[var(--muted)]" };
}

type Editing =
  | { kind: "phase"; id: string | null }
  | { kind: "task"; id: string | null; phase: string | null }
  | { kind: "milestone"; id: string | null; phase: string | null }
  | null;

/**
 * The job's plan in one place: its phases on a timeline, and under each
 * phase the tasks to do and the milestones to reach. Ticking tasks off moves
 * their phase along; milestones carry the payments due at them.
 */
export function PlanPanel({ projectId, projectStart, projectEnd, phases, milestones, tasks, people }: {
  projectId: string;
  projectStart: string | null;
  projectEnd: string | null;
  phases: PhaseRow[];
  milestones: MilestoneRow[];
  tasks: TaskRow[];
  people: Person[];
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const { pending, error, run } = useRun();
  const t = today();
  const { actual, expected } = programmeProgress(phases);
  const lateTasks = tasks.filter((x) => x.status !== "completed" && x.due_date && x.due_date < t);
  const lateMs = milestones.filter((x) => x.status !== "completed" && x.planned_date && x.planned_date < t);
  const latePhases = phases.filter((p) => p.status !== "completed" && p.end_date && p.end_date < t);
  const nextMs = [...milestones].filter((m) => m.status !== "completed").sort((a, b) => (a.planned_date ?? "9").localeCompare(b.planned_date ?? "9"))[0];
  const pay = milestones.filter((m) => m.is_payment_milestone);
  const earned = pay.filter((m) => m.status === "completed").reduce((s, m) => s + Number(m.payment_amount), 0);
  const toCome = pay.filter((m) => m.status !== "completed").reduce((s, m) => s + Number(m.payment_amount), 0);
  const empty = !phases.length && !tasks.length && !milestones.length;
  const groups: { phase: PhaseRow | null; key: string }[] = [
    ...phases.map((p) => ({ phase: p, key: p.id })),
    ...(tasks.some((x) => !x.phase_id) || milestones.some((x) => !x.phase_id) || !phases.length ? [{ phase: null, key: "none" }] : []),
  ];

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Plan</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Phases, tasks and milestones on one timeline</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <button type="button" className="font-medium text-[var(--brand)] hover:underline" onClick={() => setEditing({ kind: "phase", id: null })}>+ Phase</button>
          <button type="button" className="font-medium text-[var(--brand)] hover:underline" onClick={() => setEditing({ kind: "task", id: null, phase: null })}>+ Task</button>
          <button type="button" className="font-medium text-[var(--brand)] hover:underline" onClick={() => setEditing({ kind: "milestone", id: null, phase: null })}>+ Milestone</button>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        {!empty && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Fact label="Progress" value={phases.length ? `${actual}%` : "—"}
              hint={phases.length ? `${expected}% expected by today` : "add phases to track it"}
              tone={phases.length && expected - actual >= 10 ? "bad" : "good"} />
            <Fact label="Late" value={String(lateTasks.length + lateMs.length + latePhases.length)}
              hint={[latePhases.length && `${latePhases.length} phase${latePhases.length === 1 ? "" : "s"}`, lateTasks.length && `${lateTasks.length} task${lateTasks.length === 1 ? "" : "s"}`, lateMs.length && `${lateMs.length} milestone${lateMs.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ") || "nothing overdue"}
              tone={lateTasks.length + lateMs.length + latePhases.length ? "bad" : "good"} />
            <Fact label="Next milestone" value={nextMs ? nextMs.name : "—"} hint={nextMs?.planned_date ? `${date(nextMs.planned_date)} · ${dueIn(nextMs.planned_date, false).text}` : ""} />
            <Fact label="Payments earned" value={money(earned)} hint={pay.length ? `${money(toCome)} still to come` : "mark milestones the client pays at"} />
          </div>
        )}

        {editing?.kind === "phase" && editing.id === null && (
          <PhaseForm projectId={projectId} onDone={() => setEditing(null)} suggestStart={phases.at(-1)?.end_date ?? projectStart} />
        )}
        {editing?.kind === "task" && editing.id === null && editing.phase === null && (
          <TaskForm projectId={projectId} phases={phases} people={people} phase={null} onDone={() => setEditing(null)} />
        )}
        {editing?.kind === "milestone" && editing.id === null && editing.phase === null && (
          <MilestoneForm projectId={projectId} phases={phases} phase={null} onDone={() => setEditing(null)} />
        )}

        {empty && !editing && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="max-w-lg text-sm text-[var(--muted)]">
              Break the job into phases, put the tasks to do under each one, and mark the milestones — like handover, or the stages the client pays at.
              Ticking tasks off moves their phase along, and the timeline shows at a glance whether it is on time.
            </p>
            <button type="button" disabled={pending} onClick={() => run(() => applyStandardProgramme(projectId))}
              className="rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
              {pending ? "Adding…" : "Start from the usual fit-out stages"}
            </button>
            <p className="text-xs text-[var(--muted)]">
              Spread across the project&apos;s dates{projectStart ? "" : " (from today, over 90 days, as it has none)"}; change any of them after.
            </p>
          </div>
        )}

        {phases.some((p) => p.start_date && p.end_date) && (
          <Timeline phases={phases} milestones={milestones} projectStart={projectStart} projectEnd={projectEnd}
            onPick={(id) => setEditing({ kind: "phase", id })} />
        )}

        {!empty && (
          <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {groups.map(({ phase, key }, gi) => {
              const pid = phase?.id ?? null;
              const myTasks = tasks.filter((x) => x.phase_id === pid).sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed") || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
              const myMs = milestones.filter((x) => x.phase_id === pid).sort((a, b) => (a.planned_date ?? "9").localeCompare(b.planned_date ?? "9"));
              const open = !(folded[key] ?? (phase?.status === "completed"));
              const doneTasks = myTasks.filter((x) => x.status === "completed").length;
              return (
                <div key={key}>
                  {/* the phase */}
                  {editing?.kind === "phase" && editing.id === pid && phase ? (
                    <div className="p-3"><PhaseForm projectId={projectId} phase={phase} onDone={() => setEditing(null)} /></div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[var(--hover)]/60 px-3 py-2 text-sm">
                      <button type="button" aria-expanded={open} onClick={() => setFolded((f) => ({ ...f, [key]: open }))}
                        className="w-4 text-xs text-[var(--muted)]">{open ? "▾" : "▸"}</button>
                      <span className="min-w-0 flex-1 truncate font-semibold">{phase ? phase.name : "Not in a phase"}</span>
                      {phase && (
                        <>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[phase.status].chip}`}>{STATUS[phase.status].label}</span>
                          <span className="flex w-28 items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white">
                              <span className="block h-full rounded-full" style={{ width: `${phase.progress_pct}%`, background: STATUS[phase.status].bar }} />
                            </span>
                            <span className="w-8 text-right text-xs text-[var(--muted)]">{Math.round(phase.progress_pct)}%</span>
                          </span>
                          <span className={`whitespace-nowrap text-xs ${latePhases.includes(phase) ? "font-medium text-red-700" : "text-[var(--muted)]"}`}>
                            {phase.start_date ? date(phase.start_date) : "—"} → {phase.end_date ? date(phase.end_date) : "—"}
                          </span>
                        </>
                      )}
                      <span className="text-xs text-[var(--muted)]">{myTasks.length ? `${doneTasks}/${myTasks.length} tasks` : ""}</span>
                      <span className="flex items-center gap-2 text-xs">
                        <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => { setFolded((f) => ({ ...f, [key]: false })); setEditing({ kind: "task", id: null, phase: pid }); }}>+ task</button>
                        <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => { setFolded((f) => ({ ...f, [key]: false })); setEditing({ kind: "milestone", id: null, phase: pid }); }}>+ milestone</button>
                        {phase && (
                          <>
                            {phase.status !== "completed" && !myTasks.length && (
                              <button type="button" disabled={pending} className="font-medium text-emerald-700 hover:underline"
                                onClick={() => run(() => savePhase({ ...phase, project_id: projectId, status: "completed", progress_pct: 100 }))}>Done</button>
                            )}
                            <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => setEditing({ kind: "phase", id: pid })}>Edit</button>
                            <button type="button" aria-label="Move up" disabled={gi === 0 || pending} className="text-[var(--muted)] disabled:opacity-30"
                              onClick={() => {
                                const ids = phases.map((x) => x.id);
                                [ids[gi - 1], ids[gi]] = [ids[gi], ids[gi - 1]];
                                run(() => movePhase(projectId, ids));
                              }}>↑</button>
                            <button type="button" aria-label="Move down" disabled={gi >= phases.length - 1 || pending} className="text-[var(--muted)] disabled:opacity-30"
                              onClick={() => {
                                const ids = phases.map((x) => x.id);
                                [ids[gi + 1], ids[gi]] = [ids[gi], ids[gi + 1]];
                                run(() => movePhase(projectId, ids));
                              }}>↓</button>
                          </>
                        )}
                      </span>
                    </div>
                  )}

                  {open && (
                    <ul className="divide-y divide-[var(--border)]">
                      {myMs.map((m) =>
                        editing?.kind === "milestone" && editing.id === m.id ? (
                          <li key={m.id} className="p-3"><MilestoneForm projectId={projectId} phases={phases} milestone={m} phase={pid} onDone={() => setEditing(null)} /></li>
                        ) : (
                          <li key={m.id} className="flex items-center gap-3 py-1.5 pl-9 pr-3 text-sm">
                            <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={m.status === "completed"} disabled={pending}
                              aria-label={`${m.name} reached`} onChange={(e) => run(() => reachMilestone(m.id, projectId, e.target.checked))} />
                            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rotate-45 bg-[var(--accent)]" title="Milestone" />
                            <span className={`min-w-0 flex-1 truncate ${m.status === "completed" ? "text-[var(--muted)] line-through" : "font-medium"}`}>
                              {m.name}
                              {m.notes ? <span className="font-normal text-[var(--muted)]"> · {m.notes}</span> : null}
                            </span>
                            {m.is_payment_milestone && (
                              <span className="whitespace-nowrap rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-[var(--brand)]">{money(m.payment_amount)}</span>
                            )}
                            <span className="w-24 text-right text-xs text-[var(--muted)]">{m.planned_date ? date(m.planned_date) : ""}</span>
                            <span className={`w-24 text-right text-xs ${dueIn(m.planned_date, m.status === "completed", m.actual_date).tone}`}>
                              {dueIn(m.planned_date, m.status === "completed", m.actual_date).text}
                            </span>
                            <button type="button" className="text-xs text-[var(--brand)] hover:underline" onClick={() => setEditing({ kind: "milestone", id: m.id, phase: pid })}>Edit</button>
                          </li>
                        ),
                      )}
                      {myTasks.map((x) =>
                        editing?.kind === "task" && editing.id === x.id ? (
                          <li key={x.id} className="p-3"><TaskForm projectId={projectId} phases={phases} people={people} task={x} phase={pid} onDone={() => setEditing(null)} /></li>
                        ) : (
                          <li key={x.id} className="flex items-center gap-3 py-1.5 pl-9 pr-3 text-sm">
                            <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={x.status === "completed"} disabled={pending}
                              aria-label={`${x.title} done`} onChange={(e) => run(() => toggleTask(x.id, projectId, e.target.checked))} />
                            <span className={`min-w-0 flex-1 truncate ${x.status === "completed" ? "text-[var(--muted)] line-through" : ""}`}>
                              {x.title}
                              {x.description ? <span className="text-[var(--muted)]"> · {x.description}</span> : null}
                            </span>
                            {x.status === "blocked" && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS.blocked.chip}`}>Blocked</span>}
                            <span className="w-28 truncate text-right text-xs text-[var(--muted)]">{people.find((p) => p.id === x.assignee_id)?.name ?? ""}</span>
                            <span className="w-24 text-right text-xs text-[var(--muted)]">{x.due_date ? date(x.due_date) : ""}</span>
                            <span className={`w-24 text-right text-xs ${dueIn(x.due_date, x.status === "completed").tone}`}>{dueIn(x.due_date, x.status === "completed").text}</span>
                            <button type="button" className="text-xs text-[var(--brand)] hover:underline" onClick={() => setEditing({ kind: "task", id: x.id, phase: pid })}>Edit</button>
                          </li>
                        ),
                      )}
                      {editing?.kind === "task" && editing.id === null && editing.phase === pid && pid !== null && (
                        <li className="p-3"><TaskForm projectId={projectId} phases={phases} people={people} phase={pid} onDone={() => setEditing(null)} /></li>
                      )}
                      {editing?.kind === "milestone" && editing.id === null && editing.phase === pid && pid !== null && (
                        <li className="p-3"><MilestoneForm projectId={projectId} phases={phases} phase={pid} onDone={() => setEditing(null)} /></li>
                      )}
                      {!myTasks.length && !myMs.length && !(editing && "phase" in editing && editing.phase === pid && editing.id === null) && (
                        <li className="py-2 pl-9 text-xs text-[var(--muted)]">Nothing under this phase yet.</li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Fact({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${tone === "bad" ? "bg-red-50" : "bg-[var(--hover)]"}`}>
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={`truncate font-semibold ${tone === "bad" ? "text-red-800" : ""}`} title={value}>{value}</p>
      {hint && <p className="truncate text-[11px] text-[var(--muted)]" title={hint}>{hint}</p>}
    </div>
  );
}

/* ─────────────── forms ─────────────── */

function Buttons({ pending, onSave, onCancel, onDelete }: { pending: boolean; onSave: () => void; onCancel: () => void; onDelete?: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" disabled={pending} onClick={onSave}
        className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
      {onDelete && (
        <button type="button" disabled={pending} className="ml-auto text-xs text-red-700 hover:underline" onClick={onDelete}>Delete</button>
      )}
    </div>
  );
}

function PhaseForm({ projectId, phase, suggestStart, onDone }: { projectId: string; phase?: PhaseRow; suggestStart?: string | null; onDone: () => void }) {
  const [v, setV] = useState<PhaseInput>({
    id: phase?.id,
    project_id: projectId,
    name: phase?.name ?? "",
    status: phase?.status ?? "not_started",
    start_date: phase?.start_date ?? suggestStart ?? null,
    end_date: phase?.end_date ?? null,
    progress_pct: Number(phase?.progress_pct ?? 0),
  });
  const { pending, error, run } = useRun();
  const set = (p: Partial<PhaseInput>) => setV((x) => ({ ...x, ...p }));
  return (
    <div className="space-y-2 rounded-lg bg-[var(--hover)] p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className={tiny} htmlFor="ph-name">Phase</label>
          <input id="ph-name" className={input} value={v.name} autoFocus placeholder="Tiling & flooring" onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="w-36">
          <label className={tiny} htmlFor="ph-s">Starts</label>
          <input id="ph-s" type="date" className={input} value={v.start_date ?? ""} onChange={(e) => set({ start_date: e.target.value || null })} />
        </div>
        <div className="w-36">
          <label className={tiny} htmlFor="ph-e">Ends</label>
          <input id="ph-e" type="date" className={input} value={v.end_date ?? ""} onChange={(e) => set({ end_date: e.target.value || null })} />
        </div>
        <div className="w-36">
          <label className={tiny} htmlFor="ph-st">Status</label>
          <select id="ph-st" className={input} value={v.status} onChange={(e) => set({ status: e.target.value as PhaseStatus })}>
            {(Object.keys(STATUS) as PhaseStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className={tiny} htmlFor="ph-p">Progress · {v.progress_pct}%</label>
          <input id="ph-p" type="range" min="0" max="100" step="5" className="w-full accent-[var(--brand)]" value={v.progress_pct}
            onChange={(e) => set({ progress_pct: Number(e.target.value) })} />
        </div>
      </div>
      <p className="text-[11px] text-[var(--muted)]">A phase with tasks moves along by itself as they are ticked off.</p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <Buttons pending={pending} onSave={() => run(() => savePhase(v), onDone)} onCancel={onDone}
        onDelete={phase ? () => { if (confirm(`Delete “${phase.name}”? Its tasks and milestones stay, out of any phase.`)) run(() => deletePhase(phase.id, projectId), onDone); } : undefined} />
    </div>
  );
}

function TaskForm({ projectId, phases, people, task, phase, onDone }: {
  projectId: string;
  phases: PhaseRow[];
  people: Person[];
  task?: TaskRow;
  phase: string | null;
  onDone: () => void;
}) {
  const [v, setV] = useState<TaskInput>({
    id: task?.id,
    project_id: projectId,
    phase_id: task?.phase_id ?? phase,
    title: task?.title ?? "",
    due_date: task?.due_date ?? null,
    assignee_id: task?.assignee_id ?? null,
    description: task?.description ?? "",
  });
  const { pending, error, run } = useRun();
  const set = (p: Partial<TaskInput>) => setV((x) => ({ ...x, ...p }));
  return (
    <div className="space-y-2 rounded-lg bg-[var(--hover)] p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className={tiny} htmlFor="tk-t">Task</label>
          <input id="tk-t" className={input} value={v.title} autoFocus placeholder="Order the wall tiles"
            onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") run(() => saveTask(v), onDone); }} />
        </div>
        <div className="w-36">
          <label className={tiny} htmlFor="tk-d">Due</label>
          <input id="tk-d" type="date" className={input} value={v.due_date ?? ""} onChange={(e) => set({ due_date: e.target.value || null })} />
        </div>
        {phases.length > 0 && (
          <div className="w-48">
            <label className={tiny} htmlFor="tk-ph">Phase</label>
            <select id="tk-ph" className={input} value={v.phase_id ?? ""} onChange={(e) => set({ phase_id: e.target.value || null })}>
              <option value="">—</option>
              {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        {people.length > 0 && (
          <div className="w-40">
            <label className={tiny} htmlFor="tk-a">Who</label>
            <select id="tk-a" className={input} value={v.assignee_id ?? ""} onChange={(e) => set({ assignee_id: e.target.value || null })}>
              <option value="">—</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <input className={input} value={v.description} placeholder="Note (optional)" aria-label="Note" onChange={(e) => set({ description: e.target.value })} />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <Buttons pending={pending} onSave={() => run(() => saveTask(v), onDone)} onCancel={onDone}
        onDelete={task ? () => { if (confirm(`Delete “${task.title}”?`)) run(() => deleteTask(task.id, projectId), onDone); } : undefined} />
    </div>
  );
}

function MilestoneForm({ projectId, phases, milestone, phase, onDone }: {
  projectId: string;
  phases: PhaseRow[];
  milestone?: MilestoneRow;
  phase: string | null;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    id: milestone?.id,
    project_id: projectId,
    name: milestone?.name ?? "",
    phase_id: milestone?.phase_id ?? phase,
    planned_date: milestone?.planned_date ?? phases.find((p) => p.id === phase)?.end_date ?? null,
    is_payment_milestone: milestone?.is_payment_milestone ?? false,
    payment_amount: Number(milestone?.payment_amount ?? 0),
    notes: milestone?.notes ?? "",
  });
  const { pending, error, run } = useRun();
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  return (
    <div className="space-y-2 rounded-lg bg-[var(--hover)] p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className={tiny} htmlFor="ms-name">Milestone</label>
          <input id="ms-name" className={input} value={v.name} autoFocus placeholder="Handover to client" onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="w-36">
          <label className={tiny} htmlFor="ms-d">Planned</label>
          <input id="ms-d" type="date" className={input} value={v.planned_date ?? ""} onChange={(e) => set({ planned_date: e.target.value || null })} />
        </div>
        {phases.length > 0 && (
          <div className="w-48">
            <label className={tiny} htmlFor="ms-ph">Phase</label>
            <select id="ms-ph" className={input} value={v.phase_id ?? ""} onChange={(e) => set({ phase_id: e.target.value || null })}>
              <option value="">—</option>
              {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={v.is_payment_milestone}
            onChange={(e) => set({ is_payment_milestone: e.target.checked })} />
          The client pays at this milestone
        </label>
        {v.is_payment_milestone && (
          <div className="w-40">
            <label className={tiny} htmlFor="ms-amt">Amount (Rf)</label>
            <input id="ms-amt" type="number" min="0" step="any" className={input} value={v.payment_amount || ""}
              onChange={(e) => set({ payment_amount: Number(e.target.value) || 0 })} />
          </div>
        )}
        <div className="min-w-48 flex-1">
          <label className={tiny} htmlFor="ms-n">Note</label>
          <input id="ms-n" className={input} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <Buttons pending={pending} onSave={() => run(() => saveMilestone(v), onDone)} onCancel={onDone}
        onDelete={milestone ? () => { if (confirm(`Delete “${milestone.name}”?`)) run(() => deleteMilestone(milestone.id, projectId), onDone); } : undefined} />
    </div>
  );
}

/* ─────────────── timeline ─────────────── */

/** Each phase as a bar across the weeks, filled as far as it has got, its milestones as diamonds, and today marked. */
function Timeline({ phases, milestones, projectStart, projectEnd, onPick }: {
  phases: PhaseRow[];
  milestones: MilestoneRow[];
  projectStart: string | null;
  projectEnd: string | null;
  onPick: (id: string) => void;
}) {
  const t = today();
  const dates = [
    projectStart,
    projectEnd,
    ...phases.flatMap((p) => [p.start_date, p.end_date]),
    ...milestones.map((m) => m.planned_date),
  ].filter(Boolean).sort() as string[];
  const lo = dates[0];
  const hi = dates[dates.length - 1];
  const span = Math.max(1, daysBetween(lo, hi) + 1);
  const x = (d: string) => (daysBetween(lo, d) / span) * 100;
  const months: string[] = [];
  for (let d = new Date(`${lo.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= hi; d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toISOString().slice(0, 10));
  }
  const loose = milestones.filter((m) => m.planned_date && !phases.some((p) => p.id === m.phase_id));
  const rows = [...phases.map((p) => ({ p, ms: milestones.filter((m) => m.phase_id === p.id && m.planned_date) })), ...(loose.length ? [{ p: null, ms: loose }] : [])];
  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-[560px]">
        <div className="relative ml-44 h-5 border-b border-[var(--border)] text-[10px] text-[var(--muted)]">
          {months.map((m) => (
            <span key={m} className="absolute top-0" style={{ left: `${Math.max(0, x(m))}%` }}>
              {new Date(`${m}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" })}
            </span>
          ))}
        </div>
        <div className="relative">
          {t >= lo && t <= hi && (
            <div className="pointer-events-none absolute inset-y-0 z-10 ml-44 w-[calc(100%-11rem)]">
              <div className="absolute inset-y-0 w-px bg-red-500" style={{ left: `${x(t)}%` }}>
                <span className="absolute -top-0.5 left-1 whitespace-nowrap text-[9px] font-medium text-red-600">today</span>
              </div>
            </div>
          )}
          {rows.map(({ p, ms: marks }) => (
            <button key={p?.id ?? "loose"} type="button" onClick={() => p && onPick(p.id)} className="flex h-7 w-full items-center text-left hover:bg-[var(--hover)]">
              <span className={`w-44 shrink-0 truncate pr-2 text-xs ${p ? "" : "italic text-[var(--muted)]"}`}>{p ? p.name : "Other milestones"}</span>
              <span className="relative h-full flex-1">
                {p?.start_date && p.end_date && (
                  <span className="absolute top-1.5 h-4 overflow-hidden rounded"
                    style={{ left: `${x(p.start_date)}%`, width: `${Math.max(0.8, ((daysBetween(p.start_date, p.end_date) + 1) / span) * 100)}%`, background: "#e4e9f0",
                      outline: p.status !== "completed" && p.end_date < t ? "1.5px solid #dc2626" : undefined }}>
                    <span className="block h-full" style={{ width: `${p.progress_pct}%`, background: STATUS[p.status].bar }} />
                  </span>
                )}
                {marks.map((m) => (
                  <span key={m.id} title={`${m.name} · ${date(m.planned_date)}`}
                    className={`absolute top-2 z-[5] h-3 w-3 -translate-x-1/2 rotate-45 border border-white ${
                      m.status === "completed" ? "bg-emerald-600" : m.planned_date! < t ? "bg-red-600" : "bg-[var(--accent)]"
                    }`}
                    style={{ left: `${x(m.planned_date!)}%` }} />
                ))}
              </span>
            </button>
          ))}
        </div>
        <p className="ml-44 mt-1 text-[10px] text-[var(--muted)]">Bars: phases, filled as far as they have got · ◆ milestones · click a phase to change it</p>
      </div>
    </div>
  );
}
