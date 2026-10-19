"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { markSent, voidSalesDoc } from "@/app/actions/sales";
import { input, small } from "@/components/form-styles";

export function DocActions({ id, type, status, voided, sent, canEdit, editable, balance, contactId }: {
  id: string; type: string; status: string; voided: boolean; sent: boolean; canEdit: boolean; editable: boolean; balance: string; contactId: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const printable = ["invoice", "credit_note", "sales_receipt"].includes(type);
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); setError(r.error ?? null); if (!r.error) setVoiding(false); });

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {printable && !voided && <Link href={`/print/sales/${id}`} className={small}>Print / PDF</Link>}
      {canEdit && !voided && (
        <>
          {type === "invoice" && Number(balance) > 0 && status !== "draft" && contactId && (
            <Link href={`/sales/payments/new?customer=${contactId}&invoice=${id}`} className={small}>Receive payment</Link>
          )}
          {type === "invoice" && !sent && status !== "draft" && <button type="button" disabled={pending} onClick={() => run(() => markSent(id))} className={small}>Mark sent</button>}
          {editable && <Link href={`/sales/${id}/edit`} className={small}>Edit</Link>}
          {voiding ? (
            <span className="flex items-center gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why void it?" aria-label="Reason for voiding" className={`${input} w-48 py-1`} />
              <button type="button" disabled={pending} onClick={() => run(() => voidSalesDoc(id, reason))} className={`${small} border-red-300 text-red-700`}>Void</button>
              <button type="button" onClick={() => setVoiding(false)} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setVoiding(true)} className="text-xs font-medium text-red-700 hover:underline">Void…</button>
          )}
        </>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
