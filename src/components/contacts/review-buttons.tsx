"use client";

import { useState, useTransition } from "react";
import { reviewContact } from "@/app/actions/contacts";
import { small } from "@/components/form-styles";

export function ReviewButtons({ id, archived }: { id: string; archived: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (a: "confirm" | "archive" | "restore") => start(async () => { const r = await reviewContact(id, a); setError(r.error ?? null); });
  return (
    <span className="flex flex-wrap items-center gap-2">
      {archived ? (
        <button type="button" disabled={pending} onClick={() => run("restore")} className={`${small} bg-white`}>Restore</button>
      ) : (
        <>
          <button type="button" disabled={pending} onClick={() => run("confirm")} className={`${small} bg-white`}>Confirm it is real</button>
          <button type="button" disabled={pending} onClick={() => run("archive")} className={`${small} bg-white`}>Archive</button>
        </>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
