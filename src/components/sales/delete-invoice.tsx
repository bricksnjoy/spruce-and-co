"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { deleteSalesDoc, restoreSalesDoc } from "@/app/actions/sales";
import { small } from "@/components/form-styles";
import { money } from "@/lib/format";

const Bin = ({ size = 16 }: { size?: number }) => (
  <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
  </svg>
);

/**
 * A bin icon that deletes an invoice after asking in a dialog: it leaves
 * Sales, the project and the reports, and its billing stage can be invoiced
 * again. When payments were received for it, they stay as the customer's
 * credit unless ticked to go too.
 */
export function DeleteInvoiceButton({ id, number, paid, iconOnly = false, afterDelete }: {
  id: string; number: string | null;
  /** what has been paid or credited on it */
  paid: number;
  /** just the bin, as on a billing stage's row */
  iconOnly?: boolean;
  /** where to go once deleted; stays on the page when not given */
  afterDelete?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [withPayments, setWithPayments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const name = number ?? "this invoice";
  const close = () => { if (!pending) { setOpen(false); setError(null); setWithPayments(false); } };

  // the safe choice has the focus; Escape closes
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const confirm = () => start(async () => {
    const r = await deleteSalesDoc(id, withPayments);
    if (r.error) { setError(r.error); return; }
    setOpen(false);
    if (afterDelete) router.push(afterDelete); else router.refresh();
  });

  return (
    <>
      {iconOnly ? (
        <button type="button" onClick={() => setOpen(true)} aria-label="Delete invoice" title="Delete invoice"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-red-50 hover:text-red-600">
          <Bin />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          className={`${small} inline-flex items-center gap-1.5 text-[var(--muted)] transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600`}>
          <Bin size={14} /> Delete
        </button>
      )}

      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={close} />
          <div role="dialog" aria-modal="true" aria-label={`Delete ${name}`}
            className="relative w-full max-w-md rounded-2xl bg-[var(--surface)] p-6 text-left shadow-2xl ring-1 ring-black/5">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"><Bin size={20} /></span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">Delete {name}?</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
                  It leaves Sales, the project and the reports, and its billing stage can be invoiced again. You can restore it for 30 days.
                </p>
              </div>
            </div>

            {paid > 0 && (
              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] p-3.5 text-sm transition-colors hover:bg-[var(--hover)]">
                <input type="checkbox" checked={withPayments} onChange={(e) => setWithPayments(e.target.checked)} className="mt-0.5 h-4 w-4 accent-red-600" />
                <span>
                  <span className="font-medium">Also delete the {money(paid)} received for it</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">Leave unticked if the money really came in: it stays as the customer&apos;s credit.</span>
                </span>
              </label>
            )}

            {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button ref={cancelRef} type="button" onClick={close} disabled={pending}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)]">
                Cancel
              </button>
              <button type="button" onClick={confirm} disabled={pending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-60">
                {pending ? "Deleting…" : "Delete invoice"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
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
