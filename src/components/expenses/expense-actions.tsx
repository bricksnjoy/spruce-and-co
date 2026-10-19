"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyCredit, approveBill, billFromPo, closePo, voidExpenseDoc } from "@/app/actions/expenses";
import { input, small } from "@/components/form-styles";
import { Card, CardHeader } from "@/components/ui";
import { money, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";

export function ExpenseActions({ id, type, status, voided, canEdit, isAdmin, contactId, balance, poClosed }: {
  id: string; type: string; status: string; voided: boolean; canEdit: boolean; isAdmin: boolean; contactId: string | null; balance: string; poClosed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const run = (fn: () => Promise<{ error?: string; id?: string }>, go?: (id: string) => string) =>
    start(async () => { const r = await fn(); setError(r.error ?? null); if (!r.error) { setVoiding(false); if (go && r.id) router.push(go(r.id)); } });
  if (!canEdit || voided) return error ? <span className="text-xs text-red-700">{error}</span> : null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {status === "awaiting_approval" && isAdmin && <button type="button" disabled={pending} onClick={() => run(() => approveBill(id))} className={small}>Approve and post</button>}
      {type === "bill" && Number(balance) > 0 && status !== "draft" && status !== "awaiting_approval" && contactId && (
        <Link href={`/expenses/pay?bill=${id}`} className={small}>Pay</Link>
      )}
      {type === "purchase_order" && !poClosed && <button type="button" disabled={pending} onClick={() => run(() => billFromPo(id, today()), (b) => `/expenses/${b}/edit`)} className={small}>Turn into a bill</button>}
      {type === "purchase_order" && <button type="button" disabled={pending} onClick={() => run(() => closePo(id, poClosed))} className={small}>{poClosed ? "Reopen" : "Close"}</button>}
      {!(type === "purchase_order" && poClosed) && <Link href={`/expenses/${id}/edit`} className={small}>Edit</Link>}
      {voiding ? (
        <span className="flex items-center gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why void it?" aria-label="Reason for voiding" className={`${input} w-48 py-1`} />
          <button type="button" disabled={pending} onClick={() => run(() => voidExpenseDoc(id, reason))} className={`${small} border-red-300 text-red-700`}>Void</button>
          <button type="button" onClick={() => setVoiding(false)} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
        </span>
      ) : <button type="button" onClick={() => setVoiding(true)} className="text-xs font-medium text-red-700 hover:underline">Void…</button>}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

/** Use a vendor credit against the vendor's open bills. */
export function ApplyCredit({ creditId, bills }: { creditId: string; bills: { id: string; label: string; balance: string }[] }) {
  const [pending, start] = useTransition();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Apply this credit to a bill" />
      <div className="divide-y divide-[var(--border)]">
        {bills.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <span>{b.label} <span className="text-[var(--muted)]">· owes {money(laariToNumber(dbToLaari(b.balance)))}</span></span>
            <span className="flex items-center gap-2">
              <input aria-label={`Amount for ${b.label}`} inputMode="decimal" value={amounts[b.id] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [b.id]: e.target.value }))} className={`${input} w-32 text-right tabular-nums`} />
              <button type="button" disabled={pending} className={small}
                onClick={() => start(async () => { const r = await applyCredit(creditId, b.id, amounts[b.id] ?? ""); setMsg(r.error ?? "Applied."); })}>Apply</button>
            </span>
          </div>
        ))}
      </div>
      {msg && <p className="px-5 py-2 text-sm text-[var(--muted)]">{msg}</p>}
    </Card>
  );
}
