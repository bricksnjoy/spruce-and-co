"use client";

import { useActionState, useState, useTransition } from "react";
import { closeYear, reopenYear, saveFinancialYear, type BooksResult } from "@/app/actions/books";

const field = "mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 text-sm text-[var(--text)]";

export function YearForm({ year, signatories, values }: {
  year: number;
  signatories: { id: string; name: string; title: string | null }[];
  values: { principal_activity: string; directors: string; report_note: string; approved_on: string; signatory_id: string; show_stamp: boolean };
}) {
  const [state, action, pending] = useActionState<BooksResult | null, FormData>(saveFinancialYear, null);
  return (
    <form action={action} className="grid gap-3 px-5 py-4 text-xs text-[var(--muted)] sm:grid-cols-2">
      <input type="hidden" name="year" value={year} />
      <label className="sm:col-span-2">Principal activity
        <input name="principal_activity" defaultValue={values.principal_activity} className={field} />
      </label>
      <label>Directors, one per line
        <textarea name="directors" rows={4} defaultValue={values.directors} placeholder={"Mujahid …\nMuaz …"} className={field} />
      </label>
      <label>Anything else for the report
        <textarea name="report_note" rows={4} defaultValue={values.report_note} placeholder="e.g. events after the year end, going concern" className={field} />
      </label>
      <label>Approved by the Board on
        <input name="approved_on" type="date" defaultValue={values.approved_on} className={field} />
      </label>
      <label>Signed by
        <select name="signatory_id" defaultValue={values.signatory_id} className={field}>
          <option value="">— choose —</option>
          {signatories.map((s) => <option key={s.id} value={s.id}>{s.name}{s.title ? `, ${s.title}` : ""}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-[var(--text)] sm:col-span-2">
        <input type="checkbox" name="show_stamp" defaultChecked={values.show_stamp} /> Add the company stamp next to the signature
      </label>
      <p className="sm:col-span-2">Signatures and the stamp are managed under Quotations → Signatures. Until an approval date is entered the statements show a blank line to sign by hand.</p>
      {state?.error && <p className="text-red-700 sm:col-span-2">{state.error}</p>}
      {state?.ok && <p className="text-emerald-700 sm:col-span-2">Saved.</p>}
      <button type="submit" disabled={pending} className="justify-self-start rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function CloseYear({ year, closed, canClose, isAdmin, snapshot }: {
  year: number;
  closed: boolean;
  canClose: boolean;
  isAdmin: boolean;
  snapshot: Record<string, number>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (closed) {
    return isAdmin ? (
      <div>
        <button type="button" disabled={pending}
          onClick={() => { if (confirm(`Reopen ${year}? Its records can be changed again until it is closed once more.`)) start(async () => { const r = await reopenYear(year); setError(r.error ?? null); }); }}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--hover)] disabled:opacity-60">
          {pending ? "Reopening…" : `Reopen ${year}`}
        </button>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    ) : (
      <p className="text-xs text-[var(--muted)]">Only an admin can reopen it.</p>
    );
  }
  return (
    <div>
      <button type="button" disabled={pending || !canClose}
        onClick={() => { if (confirm(`Close the books for ${year}? Records dated in ${year} will be locked.`)) start(async () => { const r = await closeYear(year, snapshot); setError(r.error ?? null); }); }}
        className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-50">
        {pending ? "Closing…" : `Close ${year}`}
      </button>
      {!canClose && <p className="mt-2 text-xs text-[var(--muted)]">A year can be closed once it is over and the books balance.</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
