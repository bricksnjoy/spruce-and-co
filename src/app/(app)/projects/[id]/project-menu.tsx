"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { setProjectArchived } from "@/app/actions/projects";

/** The project's ⋯ menu: edit it, or archive it out of the working lists (or bring it back). Nothing is deleted. */
export function ProjectMenu({ id, archived }: { id: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
        </div>
      )}
    </div>
  );
}
