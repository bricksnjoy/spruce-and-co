"use client";

import { useEffect, useState, useTransition } from "react";
import { addTask, setTaskDone, type TaskResult } from "@/app/actions/tasks";

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-xs font-medium text-[var(--muted)]";

export function AddTaskButton({ projects, people }: {
  projects: { id: string; label: string }[];
  people: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TaskResult | null>(null);
  const [pending, start] = useTransition();
  const action = (fd: FormData) =>
    start(async () => {
      const r = await addTask(null, fd);
      setState(r);
      if (r.ok) setOpen(false);
    });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => { setState(null); setOpen(true); }}
        className="inline-flex items-center justify-center rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)]">
        + Add task
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Add task"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
          onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--field)] shadow-[0_24px_60px_-20px_rgba(13,27,42,0.4)]"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-sm font-semibold">Add task</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                className="text-[var(--muted)] transition-colors hover:text-[var(--text)]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <form action={action} className="space-y-4 px-5 py-4">
              <div>
                <label className={label} htmlFor="t-title">Task</label>
                <input id="t-title" name="title" required autoFocus className={input} placeholder="e.g. Order the kitchen worktops" />
              </div>
              <div>
                <label className={label} htmlFor="t-project">Project</label>
                <select id="t-project" name="project_id" required className={input} defaultValue="">
                  <option value="" disabled>Choose a project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="t-due">Due</label>
                  <input id="t-due" name="due_date" type="date" className={input} />
                </div>
                <div>
                  <label className={label} htmlFor="t-who">Assigned to</label>
                  <select id="t-who" name="assignee_id" className={input} defaultValue="">
                    <option value="">Unassigned</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={label} htmlFor="t-note">Note</label>
                <textarea id="t-note" name="description" rows={3} className={input} />
              </div>
              {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
              <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
                <button type="button" onClick={() => setOpen(false)}
                  className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--hover)]">
                  Cancel
                </button>
                <button type="submit" disabled={pending}
                  className="rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
                  {pending ? "Adding…" : "Add task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function DoneButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <button type="button" disabled={pending} title={error ?? "Mark as done"}
      onClick={() => start(async () => {
        const r = await setTaskDone(id, true);
        setError(r.error ?? null);
        if (r.error) alert(r.error);
      })}
      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium hover:border-emerald-600 hover:text-emerald-700 disabled:opacity-50">
      {pending ? "…" : "Done"}
    </button>
  );
}
