"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { input, label, primary, small } from "@/components/form-styles";
import { saveExpenseDoc, type Result } from "@/app/actions/expenses";
import { readBillPhoto } from "@/app/actions/bill-intake";
import { shrinkForReading } from "@/lib/shrink-photo";
import { money, today, addDays } from "@/lib/format";
import { laariToDb, laariToNumber, percentOf, qtyTimesRate, toLaari } from "@/lib/money";
import type { ExpenseFormData } from "@/server/expense-data";

import { TITLES, blankLine, type ExpenseLine, type ExpenseType, type ExpenseValues } from "@/lib/expense-doc";
export type { ExpenseLine, ExpenseType, ExpenseValues };

/** Bill, expense, vendor credit or purchase order: the supplier's own GST figure, with the evidence to claim it. */
export function ExpenseForm({ data, values }: { data: ExpenseFormData; values: ExpenseValues }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveExpenseDoc, null as Result | null);
  const [v, setV] = useState(values);
  const [reading, setReading] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ExpenseValues>(k: K, x: ExpenseValues[K]) => setV((o) => ({ ...o, [k]: x }));
  const setLine = (i: number, patch: Partial<ExpenseLine>) => setV((o) => ({ ...o, lines: o.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  useEffect(() => {
    if (state?.ok && state.id) router.push(`/expenses/${state.id}${state.note ? `?note=${encodeURIComponent(state.note)}` : ""}`);
  }, [state, router]);

  const vendor = data.vendors.find((x) => x.id === v.contact_id);
  const lineAmount = (l: ExpenseLine) => (l.qty !== "" && l.rate !== "" ? qtyTimesRate(l.qty, l.rate) : toLaari(l.amount)) ?? 0n;
  const subtotal = v.lines.reduce((t, l) => t + lineAmount(l), 0n);
  const gst = v.lines.reduce((t, l) => t + (toLaari(l.tax_amount) ?? 0n), 0n);
  const claiming = v.type !== "purchase_order" && v.lines.some((l) => l.gst_claimable && (toLaari(l.tax_amount) ?? 0n) > 0n);
  const expired = vendor && [vendor.licence_expiry, vendor.insurance_expiry].some((d) => d && d < today());

  const chooseVendor = (id: string) => {
    const x = data.vendors.find((y) => y.id === id);
    setV((o) => ({ ...o, contact_id: id, supplier_tin: x?.tin ?? "", due_date: addDays(o.date, x?.terms_days ?? 0), currency: x?.currency ?? o.currency,
      lines: o.lines.map((l) => ({ ...l, gst_claimable: Boolean(x?.gst_registered) })) }));
  };

  // read the photographed bill: server reader if set up, otherwise on this device
  const readPhoto = async () => {
    const file = photoRef.current?.files?.[0];
    if (!file) { setReading("Choose a photo first."); return; }
    setReading("Reading…");
    const fd = new FormData(); fd.set("photo", await shrinkForReading(file));
    let f: { shop: string; supplier_tin: string; bill_no: string; issue_date: string; subtotal: number; tax_amount: number; total: number; description: string } | null = null;
    const r = await readBillPhoto(null, fd);
    if (r.fields) f = r.fields;
    else {
      try {
        const { readWithTesseract } = await import("@/lib/ocr-bill");
        const o = await readWithTesseract(file, () => {});
        f = { shop: o.shop, supplier_tin: o.supplier_tin, bill_no: o.bill_no, issue_date: o.issue_date, subtotal: o.subtotal, tax_amount: o.tax_amount, total: o.total, description: o.description };
      } catch { setReading(r.error ?? "The photo could not be read; please type the details."); return; }
    }
    const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = data.vendors.find((x) => f!.supplier_tin && x.tin && key(x.tin) === key(f!.supplier_tin)) ?? data.vendors.find((x) => f!.shop && key(x.name) === key(f!.shop));
    const cents = (n: number) => laariToDb(BigInt(Math.round(n * 100)));   // the reader returns plain numbers
    const sub = f.subtotal || (f.total && f.tax_amount ? f.total - f.tax_amount : f.total);
    setV((o) => ({
      ...o,
      contact_id: match?.id ?? o.contact_id,
      supplier_tin: f!.supplier_tin || match?.tin || o.supplier_tin,
      tax_invoice_no: f!.bill_no || o.tax_invoice_no,
      date: /^\d{4}-\d{2}-\d{2}$/.test(f!.issue_date) ? f!.issue_date : o.date,
      tax_invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(f!.issue_date) ? f!.issue_date : o.tax_invoice_date,
      lines: [{ ...o.lines[0], description: f!.description || o.lines[0].description, amount: sub ? cents(sub) : o.lines[0].amount, qty: "", rate: "",
        tax_amount: f!.tax_amount ? cents(f!.tax_amount) : "", gst_claimable: Boolean((match ?? vendor)?.gst_registered) }, ...o.lines.slice(1)],
    }));
    setReading(match ? `Read. Matched ${match.name}; please check every figure.` : `Read${f.shop ? ` "${f.shop}"` : ""}; no vendor matched, choose one. Please check every figure.`);
  };

  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      fd.set("lines", JSON.stringify(v.lines));
      // phone photos are shrunk to stay under the upload limit
      const photo = fd.get("photo");
      if (photo instanceof File && photo.size > 0) fd.set("photo", await shrinkForReading(photo, 2400));
      startTransition(() => action(fd));
    }} className="space-y-5">
      <input type="hidden" name="type" value={v.type} />
      {v.id && <input type="hidden" name="id" value={v.id} />}

      {v.type !== "purchase_order" && (
        <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div>
            <label htmlFor="e-photo" className={label}>Photo of the bill or receipt</label>
            <input id="e-photo" ref={photoRef} name="photo" type="file" accept="image/*" capture="environment" className="text-sm" />
          </div>
          <button type="button" onClick={readPhoto} className={small}>Read the photo</button>
          {reading && <p className="text-xs text-[var(--muted)]">{reading}</p>}
        </Card>
      )}

      <Card className="grid gap-4 px-5 py-5 sm:grid-cols-3">
        <div>
          <label htmlFor="e-vendor" className={label}>Vendor{v.type === "expense" ? " (optional)" : ""}</label>
          <select id="e-vendor" name="contact_id" required={v.type !== "expense"} value={v.contact_id} onChange={(e) => chooseVendor(e.target.value)} className={input}>
            <option value="">Choose…</option>
            {data.vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          {expired && <p className="mt-1 text-xs text-amber-700">This vendor&apos;s licence or insurance has expired.</p>}
        </div>
        <div>
          <label htmlFor="e-proj" className={label}>Project</label>
          <select id="e-proj" name="project_id" value={v.project_id} onChange={(e) => set("project_id", e.target.value)} className={input}>
            <option value="">No project (overhead)</option>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="e-date" className={label}>Date</label>
          <input id="e-date" name="date" type="date" required value={v.date} className={input}
            onChange={(e) => { const d = e.target.value; setV((o) => ({ ...o, date: d, due_date: d ? addDays(d, vendor?.terms_days ?? 0) : o.due_date })); }} />
        </div>
        {v.type === "bill" && (
          <div><label htmlFor="e-due" className={label}>Due</label>
            <input id="e-due" name="due_date" type="date" value={v.due_date} onChange={(e) => set("due_date", e.target.value)} className={input} /></div>
        )}
        {v.type === "expense" && (
          <div><label htmlFor="e-bank" className={label}>Paid from</label>
            <select id="e-bank" name="bank_account_id" required value={v.bank_account_id} onChange={(e) => set("bank_account_id", e.target.value)} className={input}>
              <option value="">Choose…</option>
              {data.payFrom.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select></div>
        )}
        <div>
          <label htmlFor="e-cur" className={label}>Currency</label>
          <div className="flex gap-2">
            <select id="e-cur" name="currency" value={v.currency} onChange={(e) => set("currency", e.target.value)} className={input}><option>MVR</option><option>USD</option></select>
            {v.currency !== "MVR" && <input name="fx_rate" aria-label="MVR per unit" value={v.fx_rate} onChange={(e) => set("fx_rate", e.target.value)} className={`${input} w-28 tabular-nums`} placeholder="15.42" />}
          </div>
        </div>
        <div>
          <label htmlFor="e-ref" className={label}>{v.type === "purchase_order" ? "Quote reference" : "Reference"}</label>
          <input id="e-ref" name="reference" value={v.reference} onChange={(e) => set("reference", e.target.value)} className={input} />
        </div>
      </Card>

      {v.type !== "purchase_order" && (
        <Card className="grid gap-4 px-5 py-5 sm:grid-cols-4">
          <p className="text-sm font-medium sm:col-span-4">Tax invoice <span className="font-normal text-[var(--muted)]">— needed to claim the GST back{vendor && !vendor.gst_registered ? "; this vendor is not marked GST-registered, so none can be claimed" : ""}</span></p>
          <div><label htmlFor="e-tin" className={label}>Supplier TIN</label><input id="e-tin" name="supplier_tin" value={v.supplier_tin} onChange={(e) => set("supplier_tin", e.target.value)} className={`${input} font-mono`} /></div>
          <div><label htmlFor="e-tino" className={label}>Tax invoice no.</label><input id="e-tino" name="tax_invoice_no" value={v.tax_invoice_no} onChange={(e) => set("tax_invoice_no", e.target.value)} className={input} /></div>
          <div><label htmlFor="e-tid" className={label}>Tax invoice date</label><input id="e-tid" name="tax_invoice_date" type="date" value={v.tax_invoice_date} onChange={(e) => set("tax_invoice_date", e.target.value)} className={input} /></div>
          <div><label htmlFor="e-cus" className={label}>Customs declaration</label><input id="e-cus" name="customs_ref" value={v.customs_ref} onChange={(e) => set("customs_ref", e.target.value)} className={input} placeholder="For imports" /></div>
          {claiming && (!v.supplier_tin || !v.tax_invoice_no) && !v.customs_ref && (
            <p className="text-xs text-amber-700 sm:col-span-4">GST is ticked as claimable: enter the supplier&apos;s TIN and tax invoice number (or a customs declaration), or untick it.</p>
          )}
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="w-52 px-3 py-2 font-medium">For</th><th className="px-2 py-2 font-medium">Description</th>
              <th className="w-20 px-2 py-2 font-medium">Qty</th><th className="w-24 px-2 py-2 font-medium">Rate</th>
              <th className="w-32 px-2 py-2 font-medium">Amount</th><th className="w-36 px-2 py-2 font-medium">GST charged</th>
              <th className="w-40 px-2 py-2 font-medium">Project</th><th className="w-8" />
            </tr></thead>
            <tbody>
              {v.lines.map((l, i) => {
                const byQty = l.qty !== "" && l.rate !== "";
                return (
                  <tr key={i} className="border-t border-[var(--border)] align-top">
                    <td className="px-3 py-2">
                      <select aria-label={`Line ${i + 1} account`} required value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })} className={input}>
                        <option value="">Choose…</option>
                        {(["cogs", "expense", "asset"] as const).map((ty) => (
                          <optgroup key={ty} label={ty === "cogs" ? "Job costs" : ty === "expense" ? "Overheads" : "Assets"}>
                            {data.accounts.filter((a) => a.type === ty).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2"><input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className={input} /></td>
                    <td className="px-2 py-2"><input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} className={`${input} tabular-nums`} /></td>
                    <td className="px-2 py-2"><input aria-label={`Line ${i + 1} rate`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} className={`${input} tabular-nums`} /></td>
                    <td className="px-2 py-2">
                      {byQty ? <p className="px-3 py-2 text-right tabular-nums">{money(laariToNumber(lineAmount(l)))}</p>
                        : <input aria-label={`Line ${i + 1} amount before GST`} inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} className={`${input} text-right tabular-nums`} />}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <input aria-label={`Line ${i + 1} GST`} inputMode="decimal" value={l.tax_amount} onChange={(e) => setLine(i, { tax_amount: e.target.value })} className={`${input} text-right tabular-nums`} />
                        <button type="button" title={`${Number(data.gstRate)}% of the amount`} className="rounded border border-[var(--border)] px-1.5 text-xs"
                          onClick={() => setLine(i, { tax_amount: laariToDb(percentOf(lineAmount(l), data.gstRate)) })}>{Number(data.gstRate)}%</button>
                      </div>
                      {v.type !== "purchase_order" && (
                        <label className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)]">
                          <input type="checkbox" checked={l.gst_claimable} onChange={(e) => setLine(i, { gst_claimable: e.target.checked })} /> claim it back
                        </label>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <select aria-label={`Line ${i + 1} project`} value={l.project_id} onChange={(e) => setLine(i, { project_id: e.target.value })} className={input}>
                        <option value="">{v.project_id ? "As above" : "Overhead"}</option>
                        {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
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
          <button type="button" className={small} onClick={() => setV((o) => ({ ...o, lines: [...o.lines, { ...blankLine(), gst_claimable: Boolean(vendor?.gst_registered) }] }))}>Add a line</button>
          <dl className="grid grid-cols-[auto_8rem] gap-x-6 gap-y-1 text-sm tabular-nums">
            <dt className="text-[var(--muted)]">Before GST</dt><dd className="text-right">{money(laariToNumber(subtotal))}</dd>
            <dt className="text-[var(--muted)]">GST</dt><dd className="text-right">{money(laariToNumber(gst))}</dd>
            <dt className="font-semibold">Total{v.currency !== "MVR" ? ` (${v.currency})` : ""}</dt><dd className="text-right font-semibold">{money(laariToNumber(subtotal + gst))}</dd>
          </dl>
        </div>
        <p className="px-5 pb-3 text-xs text-[var(--muted)]">GST that is not claimed back is added to the cost of the line.</p>
      </Card>

      <Card className="px-5 py-5">
        <label htmlFor="e-memo" className={label}>Note</label>
        <textarea id="e-memo" name="memo" rows={2} value={v.memo} onChange={(e) => set("memo", e.target.value)} className={input} />
      </Card>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : v.id ? "Save changes" : `Save ${TITLES[v.type].toLowerCase()}`}</button>
        {v.type === "bill" && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="draft" checked={v.is_draft} onChange={(e) => set("is_draft", e.target.checked)} className="h-4 w-4" /> Save as draft</label>
        )}
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </div>
    </form>
  );
}
