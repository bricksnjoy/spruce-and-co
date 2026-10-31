"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalesDoc, restoreSalesDoc } from "@/app/actions/sales";
import { small } from "@/components/form-styles";
import { money } from "@/lib/format";

/**
 * Delete an invoice after asking: it leaves Sales, the project and the
 * reports, and its billing stage can be invoiced again. When payments were
 * received for it, they stay as the customer's credit unless ticked to go too.
 */
export function DeleteInvoiceButton({ id, number, paid, label = "Delete…", afterDelete }: {
  id: string; number: string | null;
  /** what has been paid or credited on it */
  paid: number;
  label?: string;
  /** where to go once deleted; stays on the page when not given */
  afterDelete?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [withPayments, setWithPayments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = number ?? "this invoice";

  if (!asking) {
    return <button type="button" onClick={() => setAsking(true)} className="text-xs font-medium text-red-700 hover:underline">{label}</button>;
  }
  return (
    <div role="dialog" aria-label={`Delete ${name}`} className="w-full max-w-sm space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-left text-sm text-[var(--text)]">
      <p>Delete {name}? It leaves Sales, the project and the reports, and its billing stage can be invoiced again. You can restore it for 30 days.</p>
      {paid > 0 && (
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={withPayments} onChange={(e) => setWithPayments(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>Also delete the payments received for it ({money(paid)}). Leave unticked if the money really came in: it stays as the customer&apos;s credit.</span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending} className={`${small} border-red-300 bg-white text-red-700`}
          onClick={() => start(async () => {
            const r = await deleteSalesDoc(id, withPayments);
            setError(r.error ?? null);
            if (r.error) return;
            setAsking(false);
            if (afterDelete) router.push(afterDelete); else router.refresh();
          })}>
          {pending ? "Deleting…" : "Delete"}
        </button>
        <button type="button" onClick={() => { setAsking(false); setError(null); }} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Put a deleted invoice back, on its billing stage and with its payments. */
export function RestoreInvoiceButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} className={small}
        onClick={() => start(async () => {
          const r = await restoreSalesDoc(id);
          setError(r.error ?? null);
          router.refresh();
        })}>
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
