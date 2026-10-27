"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBill, restoreBill } from "@/app/actions/expenses";

/** A bin icon on a bill's row: deletes it, with its payment, after asking; it can be restored for 30 days. */
export function DeleteBillButton({ billId, number }: { billId: string; number: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" disabled={pending} aria-label={`Delete ${number ?? "this bill"}`} title="Delete"
        className="inline-flex rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        onClick={() => {
          if (!confirm(`Delete ${number ?? "this bill"}? Its payment is removed with it. You can restore it from Deleted bills for 30 days.`)) return;
          start(async () => {
            const r = await deleteBill(billId);
            setError(r.error ?? null);
            router.refresh();
          });
        }}>
        <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
        </svg>
      </button>
      {error && <span className="mt-1 max-w-56 text-right text-xs text-red-700">{error}</span>}
    </span>
  );
}

/** Put a deleted bill back as it was, with its payment. */
export function RestoreBillButton({ billId }: { billId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" disabled={pending}
        className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-medium hover:bg-[var(--hover)] disabled:opacity-50"
        onClick={() => start(async () => {
          const r = await restoreBill(billId);
          setError(r.error ?? null);
          router.refresh();
        })}>
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error && <span className="mt-1 max-w-56 text-right text-xs text-red-700">{error}</span>}
    </span>
  );
}
