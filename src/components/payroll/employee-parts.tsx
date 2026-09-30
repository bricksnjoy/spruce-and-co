"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { Card, CardHeader } from "@/components/ui";
import { input, label, small, primary } from "@/components/form-styles";
import { giveAdvance, saveAllocations, setStandingItem, type Result } from "@/app/actions/payroll";
import { date, today } from "@/lib/format";

/** Standing allowances and deductions, copied into each month's payslip. */
export function StandingItems({ employeeId, items, standing }: { employeeId: string; items: { id: string; name: string; kind: string }[]; standing: Record<string, string> }) {
  const [vals, setVals] = useState(standing);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Every month" subtitle="Allowances and fixed deductions put on each new payslip; blank for none" />
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.id}>
            <label htmlFor={`si-${it.id}`} className="mb-1 block text-xs font-medium">{it.name}{it.kind === "deduction" ? " (deduction)" : ""}</label>
            <input id={`si-${it.id}`} inputMode="decimal" value={vals[it.id] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [it.id]: e.target.value }))}
              onBlur={() => { if ((vals[it.id] ?? "") !== (standing[it.id] ?? "")) start(async () => { const r = await setStandingItem(employeeId, it.id, vals[it.id] ?? ""); setMsg(r.error ?? "Saved."); }); }}
              className={`${input} tabular-nums`} />
          </div>
        ))}
      </div>
      {(msg || pending) && <p className="px-5 pb-3 text-xs text-[var(--muted)]">{pending ? "Saving…" : msg}</p>}
    </Card>
  );
}

/** How a site employee's cost is split across projects, from a month on. */
export function Allocations({ employeeId, projects, current, since }: { employeeId: string; projects: { id: string; code: string; name: string }[];
  current: { project_id: string | null; percent: string }[]; since: string | null }) {
  const [rows, setRows] = useState(current.length ? current : [{ project_id: null, percent: "100" }]);
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Cost split" subtitle={since ? `In force since ${date(since)}; a new split applies from the month you choose` : "Not set: all cost goes to overhead"} />
      <div className="space-y-2 px-5 py-4">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <select aria-label="Project" value={r.project_id ?? ""} onChange={(e) => setRows((x) => x.map((y, j) => j === i ? { ...y, project_id: e.target.value || null } : y))} className={`${input} w-72`}>
              <option value="">Overhead</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
            <input aria-label="Percent" inputMode="decimal" value={r.percent} onChange={(e) => setRows((x) => x.map((y, j) => j === i ? { ...y, percent: e.target.value } : y))} className={`${input} w-24 text-right`} />
            <span className="self-center text-sm">%</span>
            {rows.length > 1 && <button type="button" aria-label="Remove" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="px-2 text-[var(--muted)] hover:text-red-700">×</button>}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button type="button" className="text-xs text-[var(--brand)] hover:underline" onClick={() => setRows((x) => [...x, { project_id: null, percent: "" }])}>Add a project</button>
          <label className="text-xs">From <input type="month" value={from.slice(0, 7)} onChange={(e) => setFrom(`${e.target.value}-01`)} className={`${input} ml-1 inline w-40 py-1`} /></label>
          <button type="button" disabled={pending} className={small} onClick={() => start(async () => { const r = await saveAllocations(employeeId, from, rows); setMsg(r.error ?? "Saved."); })}>Save split</button>
          {msg && <span className="text-xs text-[var(--muted)]">{msg}</span>}
        </div>
      </div>
    </Card>
  );
}

export function AdvanceForm({ employeeId, banks }: { employeeId: string; banks: { id: string; code: string; name: string }[] }) {
  const [state, action, pending] = useActionState(giveAdvance, null as Result | null);
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="grid gap-3 px-5 py-4 sm:grid-cols-3">
      <input type="hidden" name="employee_id" value={employeeId} />
      <div><label htmlFor="ad-amt" className={label}>Advance</label><input id="ad-amt" name="amount" inputMode="decimal" required className={`${input} tabular-nums`} /></div>
      <div><label htmlFor="ad-inst" className={label}>Taken back each month</label><input id="ad-inst" name="instalment" inputMode="decimal" required className={`${input} tabular-nums`} /></div>
      <div><label htmlFor="ad-start" className={label}>Starting</label><input id="ad-start" name="start_month" type="month" required defaultValue={today().slice(0, 7)} className={input} /></div>
      <div><label htmlFor="ad-date" className={label}>Paid on</label><input id="ad-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
      <div><label htmlFor="ad-bank" className={label}>Paid from</label>
        <select id="ad-bank" name="bank_account_id" required defaultValue="" className={input}><option value="">Choose…</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></div>
      <div className="flex items-end gap-3"><button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Give advance"}</button></div>
      {state?.error && <p className="text-sm text-red-700 sm:col-span-3">{state.error}</p>}
      {state?.ok && <p className="text-sm text-[var(--muted)] sm:col-span-3">Recorded; it is taken back from each payroll run until repaid.</p>}
    </form>
  );
}
