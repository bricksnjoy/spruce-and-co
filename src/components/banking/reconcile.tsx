"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { Card, CardHeader } from "@/components/ui";
import { input, label, primary, small } from "@/components/form-styles";
import { finishReconciliation, setCleared, startReconciliation, undoReconciliation, type Result } from "@/app/actions/banking";
import { date, money, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";

type Line = { id: string; date: string; amount: string; cleared: boolean; label: string; who: string };

export function StartReconciliation({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(startReconciliation, null as Result | null);
  return (
    <Card>
      <CardHeader title="Reconcile with a statement" subtitle="Enter the date and closing balance printed on the bank statement" />
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="flex flex-wrap items-end gap-3 px-5 py-4">
        <input type="hidden" name="account_id" value={accountId} />
        <div><label htmlFor="rc-date" className={label}>Statement date</label><input id="rc-date" name="statement_date" type="date" required defaultValue={today()} className={input} /></div>
        <div><label htmlFor="rc-end" className={label}>Ending balance</label><input id="rc-end" name="ending_balance" inputMode="decimal" required className={`${input} w-40 tabular-nums`} /></div>
        <button type="submit" disabled={pending} className={primary}>{pending ? "Starting…" : "Start"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </form>
    </Card>
  );
}

/** Tick what the statement shows; the difference must reach 0 to finish. */
export function Reconcile({ recon, lines, opening, canEdit }: { recon: { id: string; statement_date: string; ending_balance: string }; lines: Line[]; opening: string; canEdit: boolean }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set(lines.filter((l) => l.cleared).map((l) => l.id)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const endLaari = dbToLaari(recon.ending_balance);
  const cleared = BigInt(opening) + lines.filter((l) => ticked.has(l.id)).reduce((t, l) => t + BigInt(l.amount), 0n);
  const diff = endLaari - cleared;
  const toggle = (ids: string[], on: boolean) => {
    setTicked((t) => { const n = new Set(t); for (const i of ids) { if (on) n.add(i); else n.delete(i); } return n; });
    start(async () => { const r = await setCleared(recon.id, ids, on); setError(r.error ?? null); });
  };
  return (
    <Card>
      <CardHeader title={`Reconciling to ${date(recon.statement_date)}`}
        action={canEdit ? <button type="button" disabled={pending} className="text-xs text-red-700 hover:underline" onClick={() => start(async () => { const r = await undoReconciliation(recon.id); setError(r.error ?? null); })}>Cancel</button> : undefined} />
      <div className="grid gap-4 border-b border-[var(--border)] px-5 py-4 text-sm sm:grid-cols-3">
        <p>Statement ending balance <strong className="block text-lg tabular-nums">{money(laariToNumber(endLaari))}</strong></p>
        <p>Cleared in the books <strong className="block text-lg tabular-nums">{money(laariToNumber(cleared))}</strong></p>
        <p>Difference <strong className={`block text-lg tabular-nums ${diff === 0n ? "text-emerald-700" : "text-red-700"}`}>{money(laariToNumber(diff))}</strong></p>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
          <th className="w-10 px-5 py-2"><input type="checkbox" aria-label="Tick all" disabled={!canEdit} checked={lines.length > 0 && ticked.size === lines.length} onChange={(e) => toggle(lines.map((l) => l.id), e.target.checked)} /></th>
          <th className="px-2 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Entry</th><th className="px-5 py-2 text-right font-medium">Amount</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-[var(--border)]">
              <td className="px-5 py-2"><input type="checkbox" aria-label={`Cleared ${l.label}`} disabled={!canEdit} checked={ticked.has(l.id)} onChange={(e) => toggle([l.id], e.target.checked)} /></td>
              <td className="px-2 py-2">{date(l.date)}</td>
              <td className="px-2 py-2">{l.label} <span className="text-xs text-[var(--muted)]">{l.who}</span></td>
              <td className={`px-5 py-2 text-right tabular-nums ${BigInt(l.amount) < 0n ? "" : "text-emerald-700"}`}>{money(laariToNumber(BigInt(l.amount)))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-5 py-4">
        {canEdit && <button type="button" disabled={pending || diff !== 0n} className={primary}
          onClick={() => start(async () => { const r = await finishReconciliation(recon.id); setError(r.error ?? null); })}>Finish reconciliation</button>}
        {diff !== 0n && <span className="text-sm text-[var(--muted)]">Tick the entries the statement shows until the difference is 0.</span>}
        {error && <span className="text-sm text-red-700">{error}</span>}
      </div>
    </Card>
  );
}

export function UndoButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} className={`${small} text-red-700`} onClick={() => start(async () => { const r = await undoReconciliation(id); setError(r.error ?? null); })}>Undo</button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
