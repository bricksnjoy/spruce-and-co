"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { purgeProject, restoreProject } from "@/app/actions/projects";
import { ConfirmDelete } from "@/components/confirm-delete";

/** Put a deleted project back, with everything it had. */
export function RestoreProjectButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" disabled={pending}
        className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-medium hover:bg-[var(--hover)] disabled:opacity-50"
        onClick={() => start(async () => {
          const r = await restoreProject(id);
          setError(r.error ?? null);
          router.refresh();
        })}>
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error && <span className="mt-1 max-w-64 text-right text-xs text-red-700">{error}</span>}
    </span>
  );
}

/** A bin icon that deletes a deleted project for good, after asking. */
export function PurgeProjectButton({ id, code }: { id: string; code: string }) {
  return (
    <ConfirmDelete label={`Delete ${code} permanently`} title={`Delete ${code} permanently?`}
      body="It leaves Deleted and can no longer be restored. Its voided entries stay in the books for the record."
      onDelete={async () => { const r = await purgeProject(id); return { error: r.error }; }} />
  );
}
