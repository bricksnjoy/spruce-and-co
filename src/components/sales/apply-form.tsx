"use client";

import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { input, label, primary } from "@/components/form-styles";
import type { Result } from "@/app/actions/sales";
import { date, money, today } from "@/lib/format";
import { dbToLaari, laariToDb, laariToNumber, toLaari } from "@/lib/money";
import type { OpenInvoice } from "@/server/open-invoices";

type Mode = "payment" | "advance_application";

/**
 * Receive a payment (or use an advance) and share it across a customer's open
 * invoices. Typing the amount fills the oldest invoices first; each line can be changed.
 */
export function ApplyForm({ mode, action: act, customers, invoices, banks, initialCustomer, initialInvoice, advances }: {
  mode: Mode;
  action: (prev: Result | null, fd: FormData) => Promise<Result>;
  customers: { id: string; name: string }[];
  invoices: OpenInvoice[];
  banks: { id: string; code: string; name: string }[];
  initialCustomer?: string; initialInvoice?: string;
  advances?: Record<string, string>;   // customer → advance balance
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(act, null as Result | null);
  const [customer, setCustomer] = useState(initialCustomer ?? "");
  const mine = useMemo(() => invoices.filter((i) => i.contact_id === customer), [invoices, customer]);
  const [applied, setApplied] = useState<Record<string, string>>(() => {
    const inv = invoices.find((i) => i.id === initialInvoice);
    return inv ? { [inv.id]: laariToDb(dbToLaari(inv.balance)) } : {};
  });
  const [total, setTotal] = useState(() => {
    const inv = invoices.find((i) => i.id === initialInvoice);
    return inv ? laariToDb(dbToLaari(inv.balance)) : "";
  });
  useEffect(() => { if (state?.ok && state.id) router.push(`/sales/${state.id}`); }, [state, router]);

  // oldest first: fill each invoice's balance until the amount runs out
  const spread = (amt: string) => {
    let left = toLaari(amt) ?? 0n;
    const next: Record<string, string> = {};
    for (const i of mine) {
      const b = dbToLaari(i.balance);
      const take = left > b ? b : left;
      if (take > 0n) next[i.id] = laariToDb(take);
      left -= take;
    }
    setApplied(next);
  };
  const sum = Object.values(applied).reduce((a, x) => a + (toLaari(x) ?? 0n), 0n);
  const received = mode === "payment" ? toLaari(total) ?? 0n : sum;
  const credit = received - sum;
  const advanceLeft = mode === "advance_application" && customer ? dbToLaari(advances?.[customer] ?? "0") : 0n;

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      fd.set("applications", JSON.stringify(Object.entries(applied).map(([to, amount]) => ({ to, amount }))));
      startTransition(() => action(fd));
    }} className="space-y-5">
      <Card className="grid gap-4 px-5 py-5 sm:grid-cols-3">
        <div>
          <label htmlFor="p-cust" className={label}>Customer</label>
          <select id="p-cust" name="contact_id" required value={customer} onChange={(e) => { setCustomer(e.target.value); setApplied({}); setTotal(""); }} className={input}>
            <option value="">Choose…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {mode === "advance_application" && customer && <p className="mt-1 text-xs text-[var(--muted)]">Advance held: {money(laariToNumber(advanceLeft))}</p>}
        </div>
        <div>
          <label htmlFor="p-date" className={label}>Date</label>
          <input id="p-date" name="date" type="date" required defaultValue={today()} className={input} />
        </div>
        {mode === "payment" && (
          <>
            <div>
              <label htmlFor="p-amt" className={label}>Amount received</label>
              <input id="p-amt" name="total_amount" inputMode="decimal" required value={total} className={`${input} tabular-nums`}
                onChange={(e) => { setTotal(e.target.value); spread(e.target.value); }} />
            </div>
            <div>
              <label htmlFor="p-bank" className={label}>Paid into</label>
              <select id="p-bank" name="bank_account_id" className={input} defaultValue="">
                <option value="">Undeposited funds (bank it later)</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="p-ref" className={label}>Reference</label>
              <input id="p-ref" name="reference" className={input} placeholder="Cheque or transfer no." />
            </div>
          </>
        )}
      </Card>

      <Card>
        {!customer ? <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">Choose the customer to see their open invoices.</p>
          : mine.length === 0 ? <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">No open invoices.{mode === "payment" ? " The whole amount will be held as credit." : ""}</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-5 py-2 font-medium">Invoice</th><th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th><th className="w-40 px-5 py-2 text-right font-medium">Apply</th></tr></thead>
            <tbody>
              {mine.map((i) => (
                <tr key={i.id} className="border-t border-[var(--border)]">
                  <td className="px-5 py-2"><span className="font-mono text-xs">{i.number}</span> <span className="text-xs text-[var(--muted)]">{date(i.date)}{i.project_code ? ` · ${i.project_code}` : ""}</span></td>
                  <td className={`px-3 py-2 ${i.due_date && i.due_date < today() ? "text-red-700" : ""}`}>{date(i.due_date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(laariToNumber(dbToLaari(i.balance)))}</td>
                  <td className="px-5 py-2"><input aria-label={`Apply to ${i.number}`} inputMode="decimal" value={applied[i.id] ?? ""}
                    onChange={(e) => setApplied((a) => ({ ...a, [i.id]: e.target.value }))} className={`${input} text-right tabular-nums`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <dl className="flex flex-wrap justify-end gap-x-8 gap-y-1 border-t border-[var(--border)] px-5 py-3 text-sm tabular-nums">
          <div><dt className="inline text-[var(--muted)]">Applied </dt><dd className="inline font-semibold">{money(laariToNumber(sum))}</dd></div>
          {mode === "payment" && <div><dt className="inline text-[var(--muted)]">Left as credit </dt><dd className={`inline font-semibold ${credit < 0n ? "text-red-700" : ""}`}>{money(laariToNumber(credit))}</dd></div>}
        </dl>
      </Card>

      <Card className="px-5 py-4"><label htmlFor="p-memo" className={label}>Note</label><input id="p-memo" name="memo" className={input} /></Card>
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending || (mode === "payment" && credit < 0n) || (mode === "advance_application" && (sum <= 0n || sum > advanceLeft))} className={primary}>
          {pending ? "Saving…" : mode === "payment" ? "Save payment" : "Apply advance"}
        </button>
        {mode === "payment" && credit < 0n && <p className="text-sm text-red-700">More is applied than was received.</p>}
        {mode === "advance_application" && sum > advanceLeft && <p className="text-sm text-red-700">That is more than the advance held.</p>}
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </div>
    </form>
  );
}
