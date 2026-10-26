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

  const pay = (i: OpenInvoice, on: boolean) => {
    const next = { ...applied };
    if (on) next[i.id] = laariToDb(dbToLaari(i.balance)); else delete next[i.id];
    setApplied(next);
    // when the amount was not typed yet, it follows the invoices ticked
    if (mode === "payment" && !(toLaari(total) ?? 0n)) setTotal(laariToDb(Object.values(next).reduce((a, x) => a + (toLaari(x) ?? 0n), 0n)));
  };
  const step = (n: number, title: string, hint?: string) => (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-xs font-semibold text-white">{n}</span>
      <div><h2 className="text-sm font-semibold">{title}</h2>{hint && <p className="text-xs text-[var(--muted)]">{hint}</p>}</div>
    </div>
  );
  const m = (v: bigint) => money(laariToNumber(v));

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      fd.set("applications", JSON.stringify(Object.entries(applied).map(([to, amount]) => ({ to, amount }))));
      startTransition(() => action(fd));
    }} className="space-y-5">
      <Card className="px-5 py-5">
        {step(1, mode === "payment" ? "Who paid, and how much" : "Whose advance")}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="p-cust" className={label}>Customer</label>
            <select id="p-cust" name="contact_id" required value={customer} onChange={(e) => { setCustomer(e.target.value); setApplied({}); setTotal(""); }} className={input}>
              <option value="">Choose…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {mode === "advance_application" && customer && <p className="mt-1 text-xs text-[var(--muted)]">Advance held: {m(advanceLeft)}</p>}
          </div>
          {mode === "payment" && (
            <div>
              <label htmlFor="p-amt" className={label}>Amount received (Rf)</label>
              <input id="p-amt" name="total_amount" inputMode="decimal" required value={total} placeholder="0.00" className={`${input} tabular-nums`}
                onChange={(e) => { setTotal(e.target.value); spread(e.target.value); }} />
            </div>
          )}
          <div>
            <label htmlFor="p-date" className={label}>Date received</label>
            <input id="p-date" name="date" type="date" required defaultValue={today()} className={input} />
          </div>
          {mode === "payment" && (
            <>
              <div>
                <label htmlFor="p-bank" className={label}>Where the money is</label>
                <select id="p-bank" name="bank_account_id" className={input} defaultValue="">
                  <option value="">Not banked yet (cheque or cash in hand)</option>
                  {banks.map((b) => <option key={b.id} value={b.id}>Already in {b.name} ({b.code})</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="p-ref" className={label}>Reference <span className="font-normal text-[var(--muted)]">(optional)</span></label>
                <input id="p-ref" name="reference" className={input} placeholder="Cheque or transfer no." />
              </div>
            </>
          )}
          <div>
            <label htmlFor="p-memo" className={label}>Note <span className="font-normal text-[var(--muted)]">(optional)</span></label>
            <input id="p-memo" name="memo" className={input} />
          </div>
        </div>
      </Card>

      <Card className="py-5">
        <div className="px-5">{step(2, "Which invoices it pays", mode === "payment" ? "Tick an invoice to pay it in full, or type a part payment. Typing the amount above fills the oldest first." : "Tick an invoice to use the advance on it, or type a part.")}</div>
        {!customer ? <p className="px-5 py-6 text-center text-sm text-[var(--muted)]">Choose the customer to see what they owe.</p>
          : mine.length === 0 ? <p className="px-5 py-6 text-center text-sm text-[var(--muted)]">This customer owes nothing.{mode === "payment" ? " The whole amount will be kept as their credit." : ""}</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="w-10 px-5 py-2" /><th className="px-3 py-2 font-medium">Invoice</th>
              <th className="px-3 py-2 text-right font-medium">Invoice total</th><th className="px-3 py-2 text-right font-medium">Still owed</th>
              <th className="w-40 px-5 py-2 text-right font-medium">Paying now</th></tr></thead>
            <tbody>
              {mine.map((i) => {
                const owed = dbToLaari(i.balance), now = toLaari(applied[i.id] ?? "") ?? 0n;
                const late = i.due_date && i.due_date < today();
                return (
                  <tr key={i.id} className={`border-t border-[var(--border)] ${now > 0n ? "bg-[var(--brand-soft)]" : ""}`}>
                    <td className="px-5 py-2"><input type="checkbox" aria-label={`Pay ${i.number} in full`} checked={now > 0n} onChange={(e) => pay(i, e.target.checked)} className="h-4 w-4" /></td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{i.number}</span>{i.project_code && <span className="text-[var(--muted)]"> · {i.project_code}</span>}
                      <span className="block text-xs text-[var(--muted)]">
                        Due {date(i.due_date)}{late && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 font-medium text-red-700">overdue</span>}
                        {now > 0n && now < owed && <span className="ml-1.5">· part payment, {m(owed - now)} will still be owed</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">{m(dbToLaari(i.total))}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{m(owed)}</td>
                    <td className="px-5 py-2"><input aria-label={`Apply to ${i.number}`} inputMode="decimal" value={applied[i.id] ?? ""} placeholder="0.00"
                      onChange={(e) => setApplied((a) => ({ ...a, [i.id]: e.target.value }))} className={`${input} text-right tabular-nums`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="px-5 py-5">
        {step(3, "Check and save")}
        <dl className="grid gap-3 text-sm tabular-nums sm:grid-cols-3">
          {mode === "payment" && <div className="rounded-lg bg-[var(--hover)] px-4 py-3"><dt className="text-xs text-[var(--muted)]">Received</dt><dd className="text-lg font-semibold">{m(received)}</dd></div>}
          <div className="rounded-lg bg-[var(--hover)] px-4 py-3"><dt className="text-xs text-[var(--muted)]">Paying invoices</dt><dd className="text-lg font-semibold">{m(sum)}</dd></div>
          {mode === "payment" && (
            <div className={`rounded-lg px-4 py-3 ${credit < 0n ? "bg-red-50" : "bg-[var(--hover)]"}`}>
              <dt className="text-xs text-[var(--muted)]">{credit < 0n ? "Short by" : "Kept as the customer's credit"}</dt>
              <dd className={`text-lg font-semibold ${credit < 0n ? "text-red-700" : ""}`}>{m(credit < 0n ? -credit : credit)}</dd>
            </div>
          )}
        </dl>
        {mode === "payment" && credit > 0n && <p className="mt-2 text-xs text-[var(--muted)]">Credit is used up automatically when you receive their next payment or apply it to a later invoice.</p>}
        <div className="mt-4 flex items-center gap-4">
          <button type="submit" disabled={pending || (mode === "payment" && credit < 0n) || (mode === "advance_application" && (sum <= 0n || sum > advanceLeft))} className={primary}>
            {pending ? "Saving…" : mode === "payment" ? "Save payment" : "Apply advance"}
          </button>
          {mode === "payment" && credit < 0n && <p className="text-sm text-red-700">The invoices ticked come to more than was received.</p>}
          {mode === "advance_application" && sum > advanceLeft && <p className="text-sm text-red-700">That is more than the advance held.</p>}
          {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        </div>
      </Card>
    </form>
  );
}
