"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { input, small } from "@/components/form-styles";
import { PRESETS } from "@/lib/report-period";
import { deleteSavedReport, saveReport } from "@/app/actions/reports";

type Opt = { id: string; name: string };
export type FilterProps = {
  reportKey: string; filters: string[]; by?: [string, string][];
  values: { preset: string; from: string; to: string; compare: string; project: string; contact: string; account: string; employee: string; by: string };
  options: { projects?: Opt[]; contacts?: Opt[]; accounts?: Opt[]; employees?: Opt[] };
};

/** The report's filters as a plain GET form, so every view is a link that can be shared or saved. */
export function ReportFilters({ reportKey, filters, by, values, options }: FilterProps) {
  const [preset, setPreset] = useState(values.preset);
  const has = (f: string) => filters.includes(f);
  const sel = (name: keyof typeof options, label: string, value: string) => (
    <div>
      <label htmlFor={`f-${name}`} className="mb-1 block text-xs text-[var(--muted)]">{label}</label>
      <select id={`f-${name}`} name={name.replace(/s$/, "")} defaultValue={value} className={`${input} py-1.5`}>
        <option value="">All</option>
        {(options[name] ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
  return (
    <form action={`/reports/${reportKey}`} method="get" className="flex flex-wrap items-end gap-3">
      {(has("range") || has("asAt")) && (
        <>
          <div>
            <label htmlFor="f-preset" className="mb-1 block text-xs text-[var(--muted)]">{has("asAt") ? "As at" : "Period"}</label>
            <select id="f-preset" name="preset" value={preset} onChange={(e) => setPreset(e.target.value)} className={`${input} py-1.5`}>
              {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {has("range") && <div><label htmlFor="f-from" className="mb-1 block text-xs text-[var(--muted)]">From</label>
            <input id="f-from" name="from" type="date" defaultValue={values.from} onChange={() => setPreset("custom")} className={`${input} py-1.5`} /></div>}
          <div><label htmlFor="f-to" className="mb-1 block text-xs text-[var(--muted)]">{has("asAt") ? "Date" : "To"}</label>
            <input id="f-to" name="to" type="date" defaultValue={values.to} onChange={() => setPreset("custom")} className={`${input} py-1.5`} /></div>
          {has("asAt") && <input type="hidden" name="from" value={values.from} />}
        </>
      )}
      {has("compare") && (
        <div>
          <label htmlFor="f-compare" className="mb-1 block text-xs text-[var(--muted)]">Compare with</label>
          <select id="f-compare" name="compare" defaultValue={values.compare} className={`${input} py-1.5`}>
            <option value="none">Nothing</option><option value="prior_period">Previous period</option><option value="prior_year">Same period last year</option>
          </select>
        </div>
      )}
      {has("by") && by && (
        <div>
          <label htmlFor="f-by" className="mb-1 block text-xs text-[var(--muted)]">Columns</label>
          <select id="f-by" name="by" defaultValue={values.by || by[0][0]} className={`${input} py-1.5`}>
            {by.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      )}
      {has("project") && sel("projects", "Project", values.project)}
      {has("contact") && sel("contacts", "Customer / vendor", values.contact)}
      {has("account") && sel("accounts", "Account", values.account)}
      {has("employee") && sel("employees", "Employee", values.employee)}
      <button type="submit" className={small}>Run report</button>
    </form>
  );
}

/** Keep this view under a name, to open again from the Reports page. */
export function SaveReport({ reportKey, query }: { reportKey: string; query: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" onClick={() => { setOpen(true); setMsg(null); }} className={small}>Save view</button>;
  return (
    <span className="inline-flex items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name for this view" className={`${input} w-40 py-1`} />
      <button type="button" disabled={pending} className={small}
        onClick={() => start(async () => { const r = await saveReport(name, reportKey, query); setMsg(r.error ?? "Saved."); if (!r.error) setOpen(false); })}>Save</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
      {msg && <span className="text-xs text-[var(--muted)]">{msg}</span>}
    </span>
  );
}

export function DeleteSaved({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} aria-label="Remove saved view" className="text-xs text-red-700 hover:underline"
      onClick={() => start(async () => { await deleteSavedReport(id); router.refresh(); })}>Remove</button>
  );
}
