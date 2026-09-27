"use client";

import { useState, useTransition } from "react";
import {
  applyStandardProgramme,
  deleteMilestone,
  deletePhase,
  movePhase,
  reachMilestone,
  saveMilestone,
  savePhase,
  type PhaseInput,
  type PhaseStatus,
  type ProgrammeResult,
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

function Shell({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/* ─────────────── programme ─────────────── */

/** How far along the programme is, weighted by each phase's length, and how far it should be by today. */
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

export function ProgrammePanel({ projectId, projectStart, projectEnd, phases }: {
  projectId: string;
  projectStart: string | null;
  projectEnd: string | null;
  phases: PhaseRow[];
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { pending, error, run } = useRun();
  const { actual, expected } = programmeProgress(phases);
  const behind = phases.length > 0 && expected - actual >= 10;
  const late = phases.filter((p) => p.status !== "completed" && p.end_date && p.end_date < today());

  return (
    <Shell
      title="Programme"
      subtitle={
        phases.length
          ? `${actual}% done · ${expected}% expected by today${behind ? " — behind" : ""}${late.length ? ` · ${late.length} phase${late.length === 1 ? "" : "s"} overdue` : ""}`
          : "The stages of the work, when each runs, and how far along it is"
      }
      action={
        phases.length > 0 && editing !== "new" ? (
          <button type="button" onClick={() => setEditing("new")} className="text-xs font-medium text-[var(--brand)] hover:underline">
            + Add a phase
          </button>
        ) : null
      }>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {!phases.length && editing !== "new" && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="max-w-md text-sm text-[var(--muted)]">
            Break the job into phases — demolition, masonry, tiling, joinery and so on — with dates and progress, so you can see at a glance whether
            it is on time.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" disabled={pending} onClick={() => run(() => applyStandardProgramme(projectId))}
              className="rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
              {pending ? "Adding…" : "Start from the usual fit-out stages"}
            </button>
            <button type="button" onClick={() => setEditing("new")}
              className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--hover)]">
              + Add a phase
            </button>
          </div>
          <p className="text-xs text-[var(--muted)]">
            The usual stages are spread across the project&apos;s dates{projectStart ? "" : " (from today, over 90 days, as it has none)"}; change any of them after.
          </p>
        </div>
      )}

      {phases.length > 0 && <Timeline phases={phases} projectStart={projectStart} projectEnd={projectEnd} onPick={(id) => setEditing(id)} />}

      {phases.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {phases.map((p, i) =>
            editing === p.id ? (
              <li key={p.id} className="py-2">
                <PhaseForm projectId={projectId} phase={p} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm 2xl:flex-nowrap">
                <span className="w-4 text-xs text-[var(--muted)]">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium" title={p.name}>{p.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[p.status].chip}`}>{STATUS[p.status].label}</span>
                <span className="flex w-28 items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--hover)]">
                    <span className="block h-full rounded-full" style={{ width: `${p.progress_pct}%`, background: STATUS[p.status].bar }} />
                  </span>
                  <span className="w-9 text-right text-xs text-[var(--muted)]">{Math.round(p.progress_pct)}%</span>
                </span>
                <span className={`whitespace-nowrap text-right text-xs ${late.includes(p) ? "font-medium text-red-700" : "text-[var(--muted)]"}`}>
                  {p.start_date ? date(p.start_date) : "—"} → {p.end_date ? date(p.end_date) : "—"}
                  {late.includes(p) ? " · late" : ""}
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {p.status !== "completed" && (
                    <button type="button" disabled={pending} className="font-medium text-emerald-700 hover:underline"
                      onClick={() => run(() => savePhase({ ...p, project_id: projectId, status: "completed", progress_pct: 100 }))}>
                      Done
                    </button>
                  )}
                  <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => setEditing(p.id)}>Edit</button>
                  <button type="button" aria-label="Move up" disabled={i === 0 || pending} className="text-[var(--muted)] disabled:opacity-30"
                    onClick={() => {
                      const ids = phases.map((x) => x.id);
                      [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                      run(() => movePhase(projectId, ids));
                    }}>↑</button>
                  <button type="button" aria-label="Move down" disabled={i === phases.length - 1 || pending} className="text-[var(--muted)] disabled:opacity-30"
                    onClick={() => {
                      const ids = phases.map((x) => x.id);
                      [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
                      run(() => movePhase(projectId, ids));
                    }}>↓</button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === "new" && (
        <div className="mt-3">
          <PhaseForm projectId={projectId} onDone={() => setEditing(null)}
            suggestStart={phases.length ? phases[phases.length - 1].end_date : projectStart} />
        </div>
      )}
    </Shell>
  );
}

function PhaseForm({ projectId, phase, suggestStart, onDone }: {
  projectId: string;
  phase?: PhaseRow;
  suggestStart?: string | null;
  onDone: () => void;
}) {
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
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => run(() => savePhase(v), onDone)}
          className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
        {phase && (
          <button type="button" disabled={pending} className="ml-auto text-xs text-red-700 hover:underline"
            onClick={() => { if (confirm(`Delete “${phase.name}”?`)) run(() => deletePhase(phase.id, projectId), onDone); }}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/** Each phase as a bar across the weeks, filled as far as it has got, with today marked. */
function Timeline({ phases, projectStart, projectEnd, onPick }: {
  phases: PhaseRow[];
  projectStart: string | null;
  projectEnd: string | null;
  onPick: (id: string) => void;
}) {
  const dated = phases.filter((p) => p.start_date && p.end_date);
  if (!dated.length) return null;
  const t = today();
  const lo = [projectStart, ...dated.map((p) => p.start_date!)].filter(Boolean).sort()[0]!;
  const hi = [projectEnd, ...dated.map((p) => p.end_date!)].filter(Boolean).sort().at(-1)!;
  const span = Math.max(1, daysBetween(lo, hi) + 1);
  const x = (d: string) => (daysBetween(lo, d) / span) * 100;
  const months: string[] = [];
  for (let d = new Date(`${lo.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= hi; d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toISOString().slice(0, 10));
  }
  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-[560px]">
        <div className="relative ml-44 h-5 border-b border-[var(--border)] text-[10px] text-[var(--muted)]">
          {months.map((m) => (
            <span key={m} className="absolute top-0 -translate-x-0" style={{ left: `${Math.max(0, x(m))}%` }}>
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
          {phases.map((p) => (
            <button key={p.id} type="button" onClick={() => onPick(p.id)} className="flex h-7 w-full items-center text-left hover:bg-[var(--hover)]">
              <span className="w-44 shrink-0 truncate pr-2 text-xs">{p.name}</span>
              <span className="relative h-full flex-1">
                {p.start_date && p.end_date && (
                  <span className="absolute top-1.5 h-4 overflow-hidden rounded"
                    style={{ left: `${x(p.start_date)}%`, width: `${Math.max(0.8, ((daysBetween(p.start_date, p.end_date) + 1) / span) * 100)}%`, background: "#e4e9f0",
                      outline: p.status !== "completed" && p.end_date < t ? "1.5px solid #dc2626" : undefined }}>
                    <span className="block h-full" style={{ width: `${p.progress_pct}%`, background: STATUS[p.status].bar }} />
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── milestones ─────────────── */

export function MilestonesPanel({ projectId, milestones, phases }: { projectId: string; milestones: MilestoneRow[]; phases: PhaseRow[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { pending, error, run } = useRun();
  const t = today();
  const list = [...milestones].sort((a, b) => (a.planned_date ?? "9999").localeCompare(b.planned_date ?? "9999"));
  const reached = list.filter((m) => m.status === "completed");
  const pay = list.filter((m) => m.is_payment_milestone);
  const payDue = pay.filter((m) => m.status === "completed").reduce((s, m) => s + Number(m.payment_amount), 0);
  const payLater = pay.filter((m) => m.status !== "completed").reduce((s, m) => s + Number(m.payment_amount), 0);
  const next = list.find((m) => m.status !== "completed");
  const phaseName = (id: string | null) => phases.find((p) => p.id === id)?.name;

  const when = (m: MilestoneRow) => {
    if (m.status === "completed") return { text: `reached ${date(m.actual_date)}`, tone: "text-emerald-700" };
    if (!m.planned_date) return { text: "no date", tone: "text-[var(--muted)]" };
    const d = daysBetween(t, m.planned_date);
    if (d < 0) return { text: `${-d} day${d === -1 ? "" : "s"} late`, tone: "font-medium text-red-700" };
    if (d === 0) return { text: "due today", tone: "font-medium text-amber-700" };
    return { text: `in ${d} day${d === 1 ? "" : "s"}`, tone: d <= 7 ? "text-amber-700" : "text-[var(--muted)]" };
  };

  return (
    <Shell
      title="Milestones"
      subtitle={
        list.length
          ? `${reached.length} of ${list.length} reached${next ? ` · next: ${next.name}${next.planned_date ? `, ${date(next.planned_date)}` : ""}` : ""}`
          : "Key dates, and the stages at which the client pays"
      }
      action={
        editing !== "new" ? (
          <button type="button" onClick={() => setEditing("new")} className="text-xs font-medium text-[var(--brand)] hover:underline">
            + Add a milestone
          </button>
        ) : null
      }>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {pay.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-emerald-50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-emerald-800">Payments earned</p>
            <p className="font-semibold text-emerald-900">{money(payDue)}</p>
          </div>
          <div className="rounded-lg bg-[var(--hover)] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Still to come</p>
            <p className="font-semibold">{money(payLater)}</p>
          </div>
        </div>
      )}
      {!list.length && editing !== "new" && (
        <p className="py-4 text-center text-sm text-[var(--muted)]">
          Add the dates that matter — site handover, first fix done, handover to the client — and mark which ones the client pays at.
        </p>
      )}
      <ul className="divide-y divide-[var(--border)]">
        {list.map((m) =>
          editing === m.id ? (
            <li key={m.id} className="py-2">
              <MilestoneForm projectId={projectId} phases={phases} milestone={m} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={m.status === "completed"} disabled={pending}
                aria-label={`${m.name} reached`}
                onChange={(e) => run(() => reachMilestone(m.id, projectId, e.target.checked))} />
              <div className="min-w-0 flex-1">
                <p className={`truncate font-medium ${m.status === "completed" ? "text-[var(--muted)] line-through" : ""}`}>{m.name}</p>
                <p className="truncate text-xs text-[var(--muted)]">
                  {m.planned_date ? date(m.planned_date) : "No date"}
                  {phaseName(m.phase_id) ? ` · ${phaseName(m.phase_id)}` : ""}
                  {m.notes ? ` · ${m.notes}` : ""}
                </p>
              </div>
              {m.is_payment_milestone && (
                <span className="whitespace-nowrap rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-[var(--brand)]">
                  {money(m.payment_amount)}
                </span>
              )}
              <span className={`w-28 text-right text-xs ${when(m).tone}`}>{when(m).text}</span>
              <button type="button" className="text-xs text-[var(--brand)] hover:underline" onClick={() => setEditing(m.id)}>Edit</button>
            </li>
          ),
        )}
      </ul>
      {editing === "new" && (
        <div className="mt-3">
          <MilestoneForm projectId={projectId} phases={phases} onDone={() => setEditing(null)} />
        </div>
      )}
    </Shell>
  );
}

function MilestoneForm({ projectId, phases, milestone, onDone }: {
  projectId: string;
  phases: PhaseRow[];
  milestone?: MilestoneRow;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    id: milestone?.id,
    project_id: projectId,
    name: milestone?.name ?? "",
    phase_id: milestone?.phase_id ?? null,
    planned_date: milestone?.planned_date ?? null,
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
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => run(() => saveMilestone(v), onDone)}
          className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
        {milestone && (
          <button type="button" disabled={pending} className="ml-auto text-xs text-red-700 hover:underline"
            onClick={() => { if (confirm(`Delete “${milestone.name}”?`)) run(() => deleteMilestone(milestone.id, projectId), onDone); }}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
