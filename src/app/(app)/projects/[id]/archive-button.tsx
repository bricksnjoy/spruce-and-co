"use client";

import { useState, useTransition } from "react";
import { setProjectArchived } from "@/app/actions/projects";

/** Archive a project out of the working lists, or bring it back. Nothing is deleted. */
export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button type="button" disabled={pending}
        onClick={() => {
          if (!archived && !confirm("Archive this project? It leaves the project lists, but every bill, invoice and payment stays on the books. You can unarchive it any time.")) return;
          start(async () => {
            const r = await setProjectArchived(id, !archived);
            setError(r.error ?? null);
          });
        }}
        className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] disabled:opacity-60">
        {pending ? "…" : archived ? "Unarchive" : "Archive"}
      </button>
    </span>
  );
}
