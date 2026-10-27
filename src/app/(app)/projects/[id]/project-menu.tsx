"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteProject, setProjectArchived } from "@/app/actions/projects";
import { undoCompletion } from "@/app/actions/partners";
import { Modal } from "@/components/modal";

/**
 * The project's ⋯ menu: edit it, archive it out of the working lists (or bring it back), and for an
 * admin, undo its completion or delete it with all its information (restorable for 30 days).
 */
export function ProjectMenu({ id, code, archived, canUndoCompletion, canDelete }: {
  id: string; code: string; archived: boolean; canUndoCompletion: boolean; canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const item = "block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)] disabled:opacity-60";
  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="More actions" title="More actions"
        className="inline-flex rounded-lg p-2 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]">
        <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg">
          <Link href={`/projects/${id}/edit`} role="menuitem" className={item} onClick={() => setOpen(false)}>Edit project</Link>
          <button type="button" role="menuitem" disabled={pending} className={item}
            onClick={() => {
              if (!archived && !confirm("Archive this project? It leaves the project lists, but every bill, invoice and payment stays on the books. You can unarchive it any time.")) return;
              start(async () => {
                const r = await setProjectArchived(id, !archived);
                setError(r.error ?? null);
                setOpen(false);
              });
            }}>
            {pending ? "…" : archived ? "Unarchive project" : "Archive project"}
          </button>
          {canUndoCompletion && (
            <button type="button" role="menuitem" disabled={pending} className={`${item} text-red-700`}
              onClick={() => {
                if (!confirm("Undo this project's completion? Its profit split is reversed and the project goes back to active. You can complete it again later.")) return;
                start(async () => {
                  const r = await undoCompletion(id);
                  setError(r.error ?? null);
                  setOpen(false);
                });
              }}>
              Undo completion
            </button>
          )}
          {canDelete && (
            <button type="button" role="menuitem" disabled={pending} className={`${item} text-red-700`}
              onClick={() => { setOpen(false); setTyped(""); setError(null); setDeleting(true); }}>
              Delete project…
            </button>
          )}
        </div>
      )}
      {deleting && (
        <Modal title="Delete project" size="md" onClose={() => setDeleting(false)}>
          <div className="space-y-4 p-5 text-sm">
            <h2 className="text-lg font-semibold">Delete {code} and all its information?</h2>
            <p>Every invoice, bill, expense, payment, financing entry and payout of this project is taken out of the books, its profit split is reversed, and the project leaves every list and report. Your bank balances change to match.</p>
            <p className="text-[var(--muted)]">You can restore it, exactly as it was, from Projects → Deleted for 30 days.</p>
            <div>
              <label htmlFor="del-code" className="mb-1 block text-xs font-medium text-[var(--muted)]">Type the project code <span className="font-mono">{code}</span> to confirm</label>
              <input id="del-code" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 font-mono text-sm" />
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleting(false)} className="rounded-lg border border-[var(--border)] px-3.5 py-2 font-medium hover:bg-[var(--hover)]">Cancel</button>
              <button type="button" disabled={pending || typed.trim() !== code}
                onClick={() => start(async () => {
                  const r = await deleteProject(id, typed.trim());
                  if (r?.error) setError(r.error);
                })}
                className="rounded-lg bg-red-600 px-3.5 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {pending ? "Deleting…" : "Delete project"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
