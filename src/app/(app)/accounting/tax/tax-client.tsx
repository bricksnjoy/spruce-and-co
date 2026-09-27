"use client";

import { useActionState, useState, useTransition } from "react";
import { addTaxPayment, deleteTaxPayment, deleteTaxReturn, saveTaxReturn, type Adjustment, type BooksResult } from "@/app/actions/books";
import { money, today } from "@/lib/format";

const field = "rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 text-sm text-[var(--text)]";

export function TaxPaymentForm() {
  const [state, action, pending] = useActionState<BooksResult | null, FormData>(addTaxPayment, null);
  return (
    <form action={action} key={state?.id ?? "new"} className="grid grid-cols-2 gap-3 px-5 py-4 text-xs text-[var(--muted)]">
      <label>Paid on<input name="paid_on" type="date" defaultValue={today()} className={`${field} mt-1 block w-full`} /></label>
      <label>Tax
        <select name="kind" defaultValue="bpt" className={`${field} mt-1 block w-full`}>
          <option value="bpt">Business profit tax</option>
          <option value="gst">GST</option>
          <option value="other">Other tax or fee</option>
        </select>
      </label>
      <label>Amount (MVR)<input name="amount" inputMode="decimal" className={`${field} mt-1 block w-full`} /></label>
      <label>For period<input name="period" placeholder="2025, or 2026 Q2" className={`${field} mt-1 block w-full`} /></label>
      <label className="col-span-2">MIRA reference<input name="reference" className={`${field} mt-1 block w-full`} /></label>
      {state?.error && <p className="col-span-2 text-red-700">{state.error}</p>}
      {state?.ok && <p className="col-span-2 text-emerald-700">Recorded.</p>}
      <button type="submit" disabled={pending} className="col-span-2 justify-self-start rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
        {pending ? "Saving…" : "Record payment"}
      </button>
    </form>
  );
}

export function RemoveTaxPayment({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      {error && <span className="mr-2 text-red-700">{error}</span>}
      <button type="button" disabled={pending} className="hover:text-red-700"
        onClick={() => { if (confirm("Delete this payment?")) start(async () => { const r = await deleteTaxPayment(id); setError(r.error ?? null); }); }}>
        Delete
      </button>
    </span>
  );
}

interface Saved {
  adjustments: Adjustment[];
  loss: number;
  filedOn: string | null;
  reference: string | null;
  note: string | null;
}

export function TaxWorksheet({ year, pbt, rate, threshold, saved, defaults, suggestedLoss, closed }: {
  year: number;
  pbt: number;
  rate: number;
  threshold: number;
  saved: Saved | null;
  defaults: Adjustment[];
  suggestedLoss: number;
  closed: boolean;
}) {
  const [rows, setRows] = useState<Adjustment[]>(saved?.adjustments ?? defaults);
  const [loss, setLoss] = useState(saved ? saved.loss : suggestedLoss);
  const [filedOn, setFiledOn] = useState(saved?.filedOn ?? "");
  const [reference, setReference] = useState(saved?.reference ?? "");
  const [note, setNote] = useState(saved?.note ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);

  const adds = rows.filter((r) => r.kind === "add").reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const less = rows.filter((r) => r.kind === "less").reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const adjusted = pbt + adds - less;
  const taxable = adjusted - loss;
  const tax = (Math.max(0, taxable - threshold) * rate) / 100;
  const set = (i: number, patch: Partial<Adjustment>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const line = (label: string, value: number, strong?: boolean) => (
    <div className={`flex justify-between px-5 py-1.5 text-sm ${strong ? "border-t border-[var(--border)] font-semibold" : ""}`}>
      <span>{label}</span><span className="tabular-nums">{money(value)}</span>
    </div>
  );

  return (
    <div className="pb-4">
      {line("Profit before tax in the accounts", pbt, true)}
      <p className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Adjustments</p>
      <div className="space-y-2 px-5 py-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select value={r.kind} disabled={closed} onChange={(e) => set(i, { kind: e.target.value as Adjustment["kind"] })} className={`${field} w-24`}>
              <option value="add">Add</option>
              <option value="less">Less</option>
            </select>
            <input value={r.label} disabled={closed} onChange={(e) => set(i, { label: e.target.value })} placeholder="e.g. Fines and penalties" className={`${field} min-w-0 flex-1`} />
            <input value={r.amount || ""} disabled={closed} inputMode="decimal" onChange={(e) => set(i, { amount: Number(e.target.value.replace(/,/g, "")) || 0 })} className={`${field} w-32 text-right`} />
            {!closed && <button type="button" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} className="text-xs text-[var(--muted)] hover:text-red-700">Remove</button>}
          </div>
        ))}
        {!closed && (
          <div className="flex flex-wrap gap-3 text-xs">
            <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => setRows((rs) => [...rs, { label: "", kind: "add", amount: 0 }])}>+ Add back an expense that is not allowed</button>
            <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => setRows((rs) => [...rs, { label: "", kind: "less", amount: 0 }])}>+ Deduct an allowance or exempt income</button>
          </div>
        )}
      </div>
      {line("Adjusted profit", adjusted, true)}
      <div className="flex items-center justify-between gap-2 px-5 py-1.5 text-sm">
        <span>Less: tax losses brought forward{suggestedLoss && !saved ? " (from last year's worksheet)" : ""}</span>
        <input value={loss || ""} disabled={closed} inputMode="decimal" onChange={(e) => setLoss(Math.max(0, Number(e.target.value.replace(/,/g, "")) || 0))} className={`${field} w-32 text-right`} />
      </div>
      {line("Taxable profit", taxable, true)}
      {line(`Less: tax-free amount`, -Math.min(Math.max(0, taxable), threshold))}
      {line(`Business profit tax at ${rate}%`, tax, true)}
      {taxable < 0 && <p className="px-5 text-xs text-[var(--muted)]">A tax loss of {money(-taxable)} carries forward to {year + 1}.</p>}

      <div className="mt-3 grid gap-3 border-t border-[var(--border)] px-5 pt-3 text-xs text-[var(--muted)] sm:grid-cols-2">
        <label>Filed with MIRA on<input type="date" disabled={closed} value={filedOn} onChange={(e) => setFiledOn(e.target.value)} className={`${field} mt-1 block w-full`} /></label>
        <label>Return reference<input disabled={closed} value={reference} onChange={(e) => setReference(e.target.value)} className={`${field} mt-1 block w-full`} /></label>
        <label className="sm:col-span-2">Notes<textarea disabled={closed} value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${field} mt-1 block w-full`} /></label>
      </div>
      {msg?.error && <p className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{msg.error}</p>}
      {msg?.ok && <p className="mx-5 mt-3 text-xs text-emerald-700">{msg.ok}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3 px-5">
        {closed ? (
          <p className="text-xs text-[var(--muted)]">{year} is closed. Reopen it under Year end to change the worksheet.</p>
        ) : (
          <>
            <button type="button" disabled={pending}
              onClick={() => start(async () => {
                const r = await saveTaxReturn({ year, pbt, adjustments: rows, lossBroughtForward: loss, filedOn: filedOn || null, reference, note });
                setMsg(r.error ? { error: r.error } : { ok: "Saved. The statements now use this tax figure." });
              })}
              className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
              {pending ? "Saving…" : "Save worksheet"}
            </button>
            {saved && (
              <button type="button" disabled={pending} className="text-xs text-[var(--muted)] hover:text-red-700"
                onClick={() => { if (confirm("Remove the worksheet and go back to the estimate?")) start(async () => { const r = await deleteTaxReturn(year); setMsg(r.error ? { error: r.error } : { ok: "Removed." }); }); }}>
                Remove worksheet
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
