"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Empty } from "@/components/ui";
import { input, label, primary } from "@/components/form-styles";
import { payBills, type Result } from "@/app/actions/expenses";
import { date, money, today } from "@/lib/format";
import { dbToLaari, laariToDb, laariToNumber, toLaari } from "@/lib/money";

export type OpenBill = { id: string; number: string | null; date: string; due_date: string | null; balance: number; vendor_name: string | null;
  contact_id: string; project_code: string | null; tax_invoice_no: string | null; licence_expiry: string | null; insurance_expiry: string | null };

export function PayBillsForm({ bills, payFrom, preselect }: { bills: OpenBill[]; payFrom: { id: string; code: string; name: string }[]; preselect?: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(payBills, null as Result | null);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const b = bills.find((x) => x.id === preselect);
    return b ? { [b.id]: laariToDb(dbToLaari(b.balance)) } : {};
  });
  useEffect(() => { if (state?.ok) router.push("/expenses?show=bill_payment"); }, [state, router]);
  const t = today();
  const picked = bills.filter((b) => (toLaari(amounts[b.id]) ?? 0n) > 0n);
  const total = picked.reduce((a, b) => a + (toLaari(amounts[b.id]) ?? 0n), 0n);
  const vendors = new Set(picked.map((b) => b.contact_id)).size;
  const lapsed = (b: OpenBill) => [b.licence_expiry, b.insurance_expiry].some((d) => d && d < t);
  const warn = picked.filter(lapsed);

  if (!bills.length) return <Card><Empty message="No bills are waiting to be paid." /></Card>;
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      fd.set("items", JSON.stringify(picked.map((b) => ({ bill: b.id, amount: amounts[b.id] }))));
      startTransition(() => action(fd));
    }} className="space-y-5">
      <Card className="grid gap-4 px-5 py-5 sm:grid-cols-3">
        <div><label htmlFor="pb-bank" className={label}>Pay from</label>
          <select id="pb-bank" name="bank_account_id" required className={input} defaultValue=""><option value="">Choose…</option>{payFrom.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></div>
        <div><label htmlFor="pb-date" className={label}>Date paid</label><input id="pb-date" name="date" type="date" required defaultValue={t} className={input} /></div>
        <div><label htmlFor="pb-ref" className={label}>Reference</label><input id="pb-ref" name="reference" className={input} placeholder="Transfer or cheque no." /></div>
      </Card>
      <Card>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
            <th className="w-10 px-5 py-2" /><th className="px-2 py-2 font-medium">Vendor</th><th className="px-2 py-2 font-medium">Bill</th><th className="px-2 py-2 font-medium">Due</th>
            <th className="px-2 py-2 text-right font-medium">Owed</th><th className="w-40 px-5 py-2 text-right font-medium">Pay</th></tr></thead>
          <tbody>
            {bills.map((b) => {
              const on = (toLaari(amounts[b.id]) ?? 0n) > 0n;
              return (
                <tr key={b.id} className="border-t border-[var(--border)]">
                  <td className="px-5 py-2"><input type="checkbox" checked={on} aria-label={`Pay ${b.number ?? "bill"}`} className="h-4 w-4"
                    onChange={(e) => setAmounts((a) => ({ ...a, [b.id]: e.target.checked ? laariToDb(dbToLaari(b.balance)) : "" }))} /></td>
                  <td className="px-2 py-2">{b.vendor_name}{lapsed(b) && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">licence or insurance expired</span>}</td>
                  <td className="px-2 py-2"><span className="font-mono text-xs">{b.number ?? b.tax_invoice_no}</span> <span className="text-xs text-[var(--muted)]">{date(b.date)}{b.project_code ? ` · ${b.project_code}` : ""}</span></td>
                  <td className={`px-2 py-2 ${b.due_date && b.due_date < t ? "text-red-700" : ""}`}>{date(b.due_date)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(laariToNumber(dbToLaari(b.balance)))}</td>
                  <td className="px-5 py-2"><input aria-label={`Amount for ${b.number ?? "bill"}`} inputMode="decimal" value={amounts[b.id] ?? ""}
                    onChange={(e) => setAmounts((a) => ({ ...a, [b.id]: e.target.value }))} className={`${input} text-right tabular-nums`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-[var(--border)] px-5 py-3 text-right text-sm">{picked.length} bill{picked.length === 1 ? "" : "s"} · {vendors} payment{vendors === 1 ? "" : "s"} · total <strong className="tabular-nums">{money(laariToNumber(total))}</strong></p>
      </Card>
      {warn.length > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {Array.from(new Set(warn.map((b) => b.vendor_name))).join(", ")}: licence or insurance has expired. Check before paying.
        </p>
      )}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending || !picked.length} className={primary}>{pending ? "Paying…" : "Record payment"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </div>
    </form>
  );
}
