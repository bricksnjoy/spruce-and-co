"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { input } from "@/components/form-styles";
import { resetTestBook, type Result } from "@/app/actions/book";

/** Admin only: wipe the Test book so trials can start again. */
export function ResetTestBook({ inTest }: { inTest: boolean }) {
  const [state, action, pending] = useActionState(resetTestBook, null as Result | null);
  return (
    <Card className="mt-6 border-amber-300">
      <CardHeader title="Reset the Test book"
        subtitle="Deletes every test document, contact, employee, project and number. The Live books are not touched." />
      <form action={action} className="flex flex-wrap items-end gap-3 px-5 py-5">
        <div>
          <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium">Type RESET to confirm</label>
          <input id="confirm" name="confirm" autoComplete="off" className={`${input} w-40 font-mono`} />
        </div>
        <button type="submit" disabled={pending}
          className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60">
          {pending ? "Resetting…" : "Reset Test book"}
        </button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && <p className="text-sm text-[var(--muted)]">The Test book is empty.{inTest ? "" : " Switch to Test to start again."}</p>}
      </form>
    </Card>
  );
}
