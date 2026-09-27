"use client";

import { useState, useTransition } from "react";
import { deleteProject } from "@/app/actions/projects";

/** Delete the project, after typing its code to be sure. */
export function DeleteProject({ id, code, bills }: { id: string; code: string; bills: number }) {
  const [typed, setTyped] = useState("");
  const [withBills, setWithBills] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = typed.trim().toUpperCase() === code.toUpperCase();

  return (
    <div className="space-y-3 text-sm">
      <p className="text-[var(--muted)]">
        Removes the project with its phases, tasks, milestones, variations, budget and financing. Quotations and estimates are kept
        but no longer linked to it. Everything deleted is kept in the change log under Accounting → Self-audit.
      </p>
      {bills > 0 && (
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={withBills} onChange={(e) => setWithBills(e.target.checked)} className="mt-1" />
          <span>
            Also delete its {bills} bill{bills > 1 ? "s" : ""}
            <span className="block text-xs text-[var(--muted)]">Untick to keep them as general company costs.</span>
          </span>
        </label>
      )}
      <label className="block text-xs text-[var(--muted)]">
        Type <b className="text-[var(--text)]">{code}</b> to confirm
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
          className="mt-1 block w-48 rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 text-sm text-[var(--text)]" />
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <button type="button" disabled={!ready || pending}
        onClick={() => start(async () => {
          setError(null);
          const r = await deleteProject(id, bills > 0 && withBills);
          if (r?.error) setError(r.error);
        })}
        className="rounded-lg bg-red-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">
        {pending ? "Deleting…" : "Delete project"}
      </button>
    </div>
  );
}
