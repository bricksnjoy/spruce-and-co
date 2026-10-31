"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

const Bin = ({ size = 16 }: { size?: number }) => (
  <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
  </svg>
);

/** A bin icon that runs `onDelete` after asking in a dialog; a refusal shows in the dialog. */
export function ConfirmDelete({ label, title, body, onDelete }: {
  /** the icon's name for screen readers, e.g. "Delete SC-LN/26/001" */
  label: string; title: string; body: string;
  onDelete: () => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const close = () => { if (!pending) { setOpen(false); setError(null); } };

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} title="Delete"
        className="relative z-[1] inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-red-50 hover:text-red-600">
        <Bin />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={close} />
          <div role="dialog" aria-modal="true" aria-label={title}
            className="relative w-full max-w-md rounded-2xl bg-[var(--surface)] p-6 text-left shadow-2xl ring-1 ring-black/5">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"><Bin size={20} /></span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">{title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">{body}</p>
              </div>
            </div>
            {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button ref={cancelRef} type="button" onClick={close} disabled={pending}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)]">Cancel</button>
              <button type="button" disabled={pending}
                onClick={() => start(async () => {
                  const r = await onDelete();
                  if (r.error) { setError(r.error); return; }
                  setOpen(false);
                  router.refresh();
                })}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-60">
                {pending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
