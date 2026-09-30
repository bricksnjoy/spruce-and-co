"use client";

import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { input, label, primary, small } from "@/components/form-styles";
import { saveSalesDoc, type Result } from "@/app/actions/sales";
import { addDays, money } from "@/lib/format";
import { laariToNumber, percentOf, qtyTimesRate, toLaari } from "@/lib/money";
import type { SalesFormData } from "@/server/sales-data";

import { TITLES, type DocType, type DocValues, type LineValue } from "@/lib/sales-doc";
export type { DocType, DocValues, LineValue };

/** Invoice, credit note or sales receipt. The database posts it and works out GST; this shows the running total. */
export function DocForm({ data, values }: { data: SalesFormData; values: DocValues }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveSalesDoc, null as Result | null);
  const [v, setV] = useState(values);
  const set = <K extends keyof DocValues>(k: K, x: DocValues[K]) => setV((o) => ({ ...o, [k]: x }));
  const setLine = (i: number, patch: Partial<LineValue>) => setV((o) => ({ ...o, lines: o.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const rateOf = useMemo(() => new Map(data.taxCodes.map((t) => [t.id, t.rate])), [data.taxCodes]);

  useEffect(() => { if (state?.ok && state.id) router.push(`/sales/${state.id}`); }, [state, router]);

  const lineAmount = (l: LineValue) => (l.qty !== "" && l.rate !== "" ? qtyTimesRate(l.qty, l.rate) : toLaari(l.amount)) ?? 0n;
  const subtotal = v.lines.reduce((t, l) => t + lineAmount(l), 0n);
  const gst = v.lines.reduce((t, l) => t + percentOf(lineAmount(l), rateOf.get(l.tax_code_id) ?? "0"), 0n);
  const projects = v.contact_id ? data.projects.filter((p) => !p.customer_id || p.customer_id === v.contact_id) : data.projects;

  const chooseCustomer = (id: string) => {
    const c = data.customers.find((x) => x.id === id);
    setV((o) => ({ ...o, contact_id: id, due_date: addDays(o.date, c?.terms_days ?? 0), currency: c?.currency ?? o.currency }));
  };

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      fd.set("lines", JSON.stringify(v.lines));
      startTransition(() => action(fd));
    }} className="space-y-5">
      <input type="hidden" name="type" value={v.type} />
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <Card className="grid gap-4 px-5 py-5 sm:grid-cols-3">
        <div>
          <label htmlFor="d-cust" className={label}>Customer</label>
          <select id="d-cust" name="contact_id" required value={v.contact_id} onChange={(e) => chooseCustomer(e.target.value)} className={input}>
            <option value="">Choose…</option>
            {data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="d-proj" className={label}>Project</label>
          <select id="d-proj" name="project_id" value={v.project_id} onChange={(e) => set("project_id", e.target.value)} className={input}>
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="d-date" className={label}>Date</label>
          <input id="d-date" name="date" type="date" required value={v.date} className={input}
            onChange={(e) => { const d = e.target.value; const c = data.customers.find((x) => x.id === v.contact_id); setV((o) => ({ ...o, date: d, due_date: d ? addDays(d, c?.terms_days ?? 0) : o.due_date })); }} />
        </div>
        {v.type === "invoice" && (
          <div>
            <label htmlFor="d-due" className={label}>Due</label>
            <input id="d-due" name="due_date" type="date" value={v.due_date} onChange={(e) => set("due_date", e.target.value)} className={input} />
            <p className="mt-1 text-xs text-[var(--muted)]">From the customer&apos;s terms; due on receipt when they have none</p>
          </div>
        )}
        {v.type === "sales_receipt" && (
          <div>
            <label htmlFor="d-bank" className={label}>Paid into</label>
            <select id="d-bank" name="bank_account_id" value={v.bank_account_id} onChange={(e) => set("bank_account_id", e.target.value)} className={input}>
              <option value="">Undeposited funds (bank it later)</option>
              {data.banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="d-cur" className={label}>Currency</label>
          <div className="flex gap-2">
            <select id="d-cur" name="currency" value={v.currency} onChange={(e) => set("currency", e.target.value)} className={input}><option>MVR</option><option>USD</option></select>
            {v.currency !== "MVR" && <input name="fx_rate" aria-label="MVR per unit" value={v.fx_rate} onChange={(e) => set("fx_rate", e.target.value)} className={`${input} w-28 tabular-nums`} placeholder="15.42" />}
          </div>
        </div>
        <div>
          <label htmlFor="d-ref" className={label}>Reference</label>
          <input id="d-ref" name="reference" value={v.reference} onChange={(e) => set("reference", e.target.value)} className={input} placeholder="Client PO, contract no." />
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">Description</th><th className="w-20 px-2 py-2 font-medium">Qty</th>
                <th className="w-28 px-2 py-2 font-medium">Rate</th><th className="w-32 px-2 py-2 font-medium">Amount</th>
                <th className="w-40 px-2 py-2 font-medium">GST</th><th className="w-40 px-2 py-2 font-medium">Income account</th><th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {v.lines.map((l, i) => {
                const byQty = l.qty !== "" && l.rate !== "";
                return (
                  <tr key={i} className="border-t border-[var(--border)] align-top">
                    <td className="px-3 py-2"><textarea rows={1} aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className={input} /></td>
                    <td className="px-2 py-2"><input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} className={`${input} tabular-nums`} /></td>
                    <td className="px-2 py-2"><input aria-label={`Line ${i + 1} rate`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} className={`${input} tabular-nums`} /></td>
                    <td className="px-2 py-2">
                      {byQty ? <p className="px-3 py-2 text-right tabular-nums">{money(laariToNumber(lineAmount(l)))}</p>
                        : <input aria-label={`Line ${i + 1} amount`} inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} className={`${input} text-right tabular-nums`} />}
                    </td>
                    <td className="px-2 py-2">
                      <select aria-label={`Line ${i + 1} GST`} value={l.tax_code_id} onChange={(e) => setLine(i, { tax_code_id: e.target.value })} className={input}>
                        <option value="">None</option>
                        {data.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.name}{t.rate !== "0" ? ` ${Number(t.rate)}%` : ""}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select aria-label={`Line ${i + 1} income account`} value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })} className={input}>
                        <option value="">Contract revenue</option>
                        {data.incomeAccounts.filter((a) => a.code !== "4000").map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      {v.lines.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setV((o) => ({ ...o, lines: o.lines.filter((_, j) => j !== i) }))} className="px-1 py-2 text-[var(--muted)] hover:text-red-700">×</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-[var(--border)] px-5 py-4">
          <button type="button" className={small}
            onClick={() => setV((o) => ({ ...o, lines: [...o.lines, { description: "", qty: "", rate: "", amount: "", tax_code_id: data.defaultTaxCode ?? "", project_id: "", account_id: "" }] }))}>
            Add a line
          </button>
          <dl className="grid grid-cols-[auto_8rem] gap-x-6 gap-y-1 text-sm tabular-nums">
            <dt className="text-[var(--muted)]">Subtotal</dt><dd className="text-right">{money(laariToNumber(subtotal))}</dd>
            <dt className="text-[var(--muted)]">GST</dt><dd className="text-right">{money(laariToNumber(gst))}</dd>
            <dt className="font-semibold">Total{v.currency !== "MVR" ? ` (${v.currency})` : ""}</dt><dd className="text-right font-semibold">{money(laariToNumber(subtotal + gst))}</dd>
          </dl>
        </div>
        <p className="px-5 pb-3 text-xs text-[var(--muted)]">Leave quantity and rate blank to type an amount. GST is charged at the rate in force on the document date.</p>
      </Card>

      <Card className="px-5 py-5">
        <label htmlFor="d-memo" className={label}>Note on the document</label>
        <textarea id="d-memo" name="memo" rows={2} value={v.memo} onChange={(e) => set("memo", e.target.value)} className={input} />
      </Card>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : v.id ? "Save changes" : `Save ${TITLES[v.type].toLowerCase()}`}</button>
        {v.type === "invoice" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="draft" checked={v.is_draft} onChange={(e) => set("is_draft", e.target.checked)} className="h-4 w-4" /> Save as draft (not posted yet)
          </label>
        )}
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </div>
    </form>
  );
}
