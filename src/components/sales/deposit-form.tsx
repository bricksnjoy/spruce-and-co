"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Empty } from "@/components/ui";
import { input, label, primary } from "@/components/form-styles";
import { makeDeposit, type Result } from "@/app/actions/sales";
import { date, money, titleize, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";

export type Receipt = { id: string; type: string; number: string | null; date: string; total: number; customer_name: string | null };

export function DepositForm({ receipts, banks }: { receipts: Receipt[]; banks: { id: string; code: string; name: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(makeDeposit, null as Result | null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { if (state?.ok && state.id) router.push(`/sales/${state.id}`); }, [state, router]);
  const total = receipts.filter((r) => picked.has(r.id)).reduce((a, r) => a + dbToLaari(r.total), 0n);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (!receipts.length) return <Card><Empty message="Nothing is waiting in Undeposited Funds." /></Card>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="space-y-5">
      <Card className="grid gap-4 px-5 py-5 sm:grid-cols-3">
        <div><label htmlFor="dp-bank" className={label}>Bank account</label>
          <select id="dp-bank" name="bank_account_id" required className={input} defaultValue=""><option value="">Choose…</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></div>
        <div><label htmlFor="dp-date" className={label}>Date banked</label><input id="dp-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
        <div><label htmlFor="dp-memo" className={label}>Note</label><input id="dp-memo" name="memo" className={input} placeholder="Deposit slip no." /></div>
      </Card>
      <Card>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]"><th className="w-10 px-5 py-2" /><th className="px-2 py-2 font-medium">Received</th><th className="px-2 py-2 font-medium">From</th><th className="px-5 py-2 text-right font-medium">Amount</th></tr></thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                <td className="px-5 py-2"><input type="checkbox" name="receipt" value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Include ${r.number ?? "receipt"}`} className="h-4 w-4" /></td>
                <td className="px-2 py-2">{date(r.date)} <span className="text-xs text-[var(--muted)]">{titleize(r.type)} {r.number ?? ""}</span></td>
                <td className="px-2 py-2">{r.customer_name ?? "—"}</td>
                <td className="px-5 py-2 text-right tabular-nums">{money(laariToNumber(dbToLaari(r.total)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-[var(--border)] px-5 py-3 text-right text-sm">Deposit total <strong className="tabular-nums">{money(laariToNumber(total))}</strong></p>
      </Card>
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending || picked.size === 0} className={primary}>{pending ? "Saving…" : "Save deposit"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </div>
    </form>
  );
}
