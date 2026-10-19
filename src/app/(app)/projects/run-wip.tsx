"use client";

import { useActionState } from "react";
import { input, small } from "@/components/form-styles";
import { runWip } from "@/app/actions/project-value";

/** Post WIP for percentage-of-completion projects at a period end. */
export function RunWip() {
  const [state, action, pending] = useActionState(runWip, null as Awaited<ReturnType<typeof runWip>> | null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="wip-end" className="mb-1 block text-xs font-medium">Post WIP at period end</label>
        <input id="wip-end" name="period_end" type="date" required className={`${input} w-40`} />
      </div>
      <button type="submit" disabled={pending} className={small}>{pending ? "Posting…" : "Post WIP"}</button>
      {state?.error && <span className="text-xs text-red-700">{state.error}</span>}
      {state?.ok && <span className="text-xs text-[var(--muted)]">{state.count ? `Posted for ${state.count} project${state.count === 1 ? "" : "s"}, reversed the next day.` : "Nothing to post: billing matches the work done."}</span>}
    </form>
  );
}
