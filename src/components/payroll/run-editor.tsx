"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { input, small, primary } from "@/components/form-styles";
import { addPayslipLine, addToRun, approveRun, paySalaries, removeFromRun, removePayslipLine, setPayslipAllocations, setRunStatus } from "@/app/actions/payroll";
import { money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";

export type Slip = {
  id: string; employee_id: string; gross: number; deductions: number; employer_contributions: number; net: number;
  employees: { name: string; department: string; nationality_type: string; job_title: string | null };
  payslip_lines: { id: string; quantity: number | null; rate: number | null; amount: number; computed: boolean; pay_item_id: string; pay_items: { code: string; name: string; kind: string; sort_order: number } }[];
  labour_allocations: { id: string; project_id: string | null; quantity: number; amount: number; projects: { code: string } | null }[];
};
type Opt = { id: string; code?: string; name: string; kind?: string; calc?: string };
const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v)));

export function RunEditor({ runId, status, displayStatus, editable, isAdmin, slips, payItems, projects, banks, notInRun, payDate }: {
  runId: string; status: string; displayStatus: string; editable: boolean; isAdmin: boolean; slips: Slip[];
  payItems: Opt[]; projects: { id: string; code: string; name: string }[]; banks: { id: string; code: string; name: string }[];
  notInRun: { id: string; name: string }[]; payDate: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [bank, setBank] = useState("");
  const [paid, setPaid] = useState(payDate);
  const [adding, setAdding] = useState("");
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); setError(r.error ?? null); });

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
        {status === "draft" && <button type="button" disabled={pending} className={small} onClick={() => run(() => setRunStatus(runId, "review"))}>Send for review</button>}
        {status === "review" && <button type="button" disabled={pending} className={small} onClick={() => run(() => setRunStatus(runId, "draft"))}>Back to draft</button>}
        {editable && isAdmin && <button type="button" disabled={pending} className={primary} onClick={() => run(() => approveRun(runId))}>Approve and post</button>}
        {editable && !isAdmin && <span className="text-[var(--muted)]">An admin approves the run, which posts it to the books.</span>}
        {status === "posted" && displayStatus !== "paid" && (
          <span className="flex flex-wrap items-center gap-2">
            <select aria-label="Pay from" value={bank} onChange={(e) => setBank(e.target.value)} className={`${input} w-56`}>
              <option value="">Pay from…</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select>
            <input type="date" aria-label="Date paid" value={paid} onChange={(e) => setPaid(e.target.value)} className={`${input} w-40`} />
            <button type="button" disabled={pending || !bank} className={primary} onClick={() => run(() => paySalaries(runId, bank, paid))}>Pay net salaries</button>
          </span>
        )}
        {displayStatus === "paid" && <span className="font-medium text-emerald-700">Paid.</span>}
        {editable && notInRun.length > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <select aria-label="Add an employee" value={adding} onChange={(e) => setAdding(e.target.value)} className={`${input} w-48`}>
              <option value="">Add someone…</option>{notInRun.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button type="button" disabled={pending || !adding} className={small} onClick={() => run(async () => { const r = await addToRun(runId, adding); if (!r.error) setAdding(""); return r; })}>Add</button>
          </span>
        )}
        {error && <p className="w-full text-sm text-red-700">{error}</p>}
      </Card>
      {slips.map((s) => <SlipCard key={s.id} slip={s} editable={editable} payItems={payItems} projects={projects} />)}
    </div>
  );
}

function SlipCard({ slip, editable, payItems, projects }: { slip: Slip; editable: boolean; payItems: Opt[]; projects: { id: string; code: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState(""); const [rate, setRate] = useState(""); const [amt, setAmt] = useState("");
  const [alloc, setAlloc] = useState<{ project_id: string | null; percent: string }[] | null>(null);
  const chosen = payItems.find((p) => p.id === item);
  const lines = [...slip.payslip_lines].sort((a, b) => a.pay_items.sort_order - b.pay_items.sort_order);
  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => start(async () => { const r = await fn(); setError(r.error ?? null); if (!r.error) after?.(); });

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
        <div>
          <p className="font-semibold">{slip.employees.name}</p>
          <p className="text-xs text-[var(--muted)]">{[slip.employees.job_title, slip.employees.department === "site" ? "Site" : "Admin", slip.employees.nationality_type === "maldivian" ? "Maldivian" : "Expatriate"].filter(Boolean).join(" · ")}</p>
        </div>
        <p className="text-sm tabular-nums">Gross {m(slip.gross)} · Deductions {m(slip.deductions)} · <strong>Net {m(slip.net)}</strong></p>
      </div>
      <div className="grid gap-4 px-5 py-3 lg:grid-cols-[1fr_20rem]">
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-[var(--border)] last:border-0">
                <td className="py-1.5">{l.pay_items.name}{l.quantity != null && <span className="text-xs text-[var(--muted)]"> · {Number(l.quantity)}{l.rate != null ? ` × ${m(l.rate)}` : ""}</span>}{l.computed && <span className="text-xs text-[var(--muted)]"> · worked out</span>}</td>
                <td className={`py-1.5 text-right tabular-nums ${l.pay_items.kind === "deduction" ? "text-red-700" : l.pay_items.kind === "employer_contribution" ? "text-[var(--muted)]" : ""}`}>
                  {l.pay_items.kind === "deduction" ? "−" : ""}{m(l.amount)}
                </td>
                <td className="w-8 py-1.5 text-right">{editable && !l.computed && (
                  <button type="button" aria-label={`Remove ${l.pay_items.name}`} disabled={pending} onClick={() => run(() => removePayslipLine(slip.id, l.id))} className="text-[var(--muted)] hover:text-red-700">×</button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-2 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Cost goes to</p>
          {alloc === null ? (
            <>
              {slip.labour_allocations.map((a) => <p key={a.id} className="flex justify-between tabular-nums"><span>{a.projects?.code ?? "Overhead"} · {Number(a.quantity)}%</span><span>{m(a.amount)}</span></p>)}
              {editable && slip.employees.department === "site" && (
                <button type="button" className="text-xs font-medium text-[var(--brand)] hover:underline"
                  onClick={() => setAlloc(slip.labour_allocations.map((a) => ({ project_id: a.project_id, percent: String(Number(a.quantity)) })))}>Change this month&apos;s split</button>
              )}
              {slip.employees.department === "admin" && <p className="text-xs text-[var(--muted)]">Admin staff are overhead.</p>}
            </>
          ) : (
            <div className="space-y-1">
              {alloc.map((a, i) => (
                <div key={i} className="flex gap-1">
                  <select aria-label="Project" value={a.project_id ?? ""} onChange={(e) => setAlloc((x) => x!.map((y, j) => j === i ? { ...y, project_id: e.target.value || null } : y))} className={`${input} py-1`}>
                    <option value="">Overhead</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                  </select>
                  <input aria-label="Percent" inputMode="decimal" value={a.percent} onChange={(e) => setAlloc((x) => x!.map((y, j) => j === i ? { ...y, percent: e.target.value } : y))} className={`${input} w-20 py-1 text-right`} />
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <button type="button" className="text-xs text-[var(--brand)] hover:underline" onClick={() => setAlloc((x) => [...x!, { project_id: null, percent: "" }])}>Add</button>
                <button type="button" disabled={pending} className={small} onClick={() => run(() => setPayslipAllocations(slip.id, alloc), () => setAlloc(null))}>Save split</button>
                <button type="button" className="text-xs text-[var(--muted)] hover:underline" onClick={() => setAlloc(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-3 text-sm">
          <select aria-label="Add to payslip" value={item} onChange={(e) => { setItem(e.target.value); setQty(""); setRate(""); setAmt(""); }} className={`${input} w-52`}>
            <option value="">Add overtime, a bonus, no-pay…</option>
            {payItems.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {chosen && (chosen.calc === "hours" || chosen.calc === "days") && <>
            <input aria-label={chosen.calc === "hours" ? "Hours" : "Days"} placeholder={chosen.calc === "hours" ? "Hours" : "Days"} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={`${input} w-20`} />
            {chosen.code !== "NOPAY" && <input aria-label="Rate" placeholder="Rate per hour" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={`${input} w-32`} />}
            {chosen.code === "NOPAY" && <span className="text-xs text-[var(--muted)]">a day is basic ÷ the no-pay divisor</span>}
          </>}
          {chosen && chosen.calc === "fixed" && <input aria-label="Amount" placeholder="Amount" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} className={`${input} w-32`} />}
          {chosen && <button type="button" disabled={pending} className={small}
            onClick={() => run(() => addPayslipLine(slip.id, item, qty, rate, amt), () => { setItem(""); setQty(""); setRate(""); setAmt(""); })}>Add</button>}
          <button type="button" disabled={pending} className="ml-auto text-xs text-red-700 hover:underline" onClick={() => run(() => removeFromRun(slip.id))}>Take off this run</button>
          {error && <p className="w-full text-sm text-red-700">{error}</p>}
        </div>
      )}
      {!editable && error && <p className="px-5 py-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
