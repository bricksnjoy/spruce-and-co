"use client";

import { useActionState, useState, useTransition } from "react";
import { input, small } from "@/components/form-styles";
import { addRate, deleteRate, type Result } from "@/app/actions/settings";

function Status({ state }: { state: Result | null }) {
  if (state?.error) return <p className="text-sm text-red-700">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-[var(--muted)]">Added.</p>;
  return null;
}

/** Add a single-percentage rate from a date. */
export function AddRate({ kind, code }: { kind: string; code: string }) {
  const [state, action, pending] = useActionState(addRate, null as Result | null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] px-5 py-4">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="code" value={code} />
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor={`${kind}-${code}-value`}>New rate (%)</label>
        <input id={`${kind}-${code}-value`} name="value" inputMode="decimal" required className={`${input} w-28 tabular-nums`} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor={`${kind}-${code}-from`}>From</label>
        <input id={`${kind}-${code}-from`} name="effective_from" type="date" required className={input} />
      </div>
      <button type="submit" disabled={pending} className={small}>{pending ? "Adding…" : "Add rate"}</button>
      <Status state={state} />
    </form>
  );
}

/** Add a set of brackets from a date. Each bracket starts where the one before it ends; the last is open-ended. */
export function AddBrackets({ kind }: { kind: string }) {
  const [state, action, pending] = useActionState(addRate, null as Result | null);
  const [ends, setEnds] = useState<string[]>([""]);   // the "to" of every bracket but the last
  const rows = ends.length + 1;

  return (
    <form action={action} className="space-y-3 border-t border-[var(--border)] px-5 py-4">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="rows" value={rows} />
      <table className="text-sm">
        <thead>
          <tr className="text-left text-xs text-[var(--muted)]"><th className="pb-1 pr-3 font-medium">From (MVR)</th><th className="pb-1 pr-3 font-medium">Up to (MVR)</th><th className="pb-1 font-medium">Rate (%)</th></tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => {
            const last = i === rows - 1;
            return (
              <tr key={i}>
                <td className="py-1 pr-3 tabular-nums text-[var(--muted)]">{i === 0 ? "0" : ends[i - 1] || "…"}</td>
                <td className="py-1 pr-3">
                  {last ? <span className="text-[var(--muted)]">and above</span> : (
                    <input name={`to_${i + 1}`} inputMode="decimal" required value={ends[i]} aria-label={`Bracket ${i + 1} ends at`}
                      onChange={(e) => setEnds((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                      className={`${input} w-36 tabular-nums`} />
                  )}
                </td>
                <td className="py-1"><input name={`rate_${i + 1}`} inputMode="decimal" required aria-label={`Bracket ${i + 1} rate`} className={`${input} w-24 tabular-nums`} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-3">
        <button type="button" className={small} onClick={() => setEnds((xs) => [...xs, ""])}>Add a bracket</button>
        {ends.length > 0 && <button type="button" className={small} onClick={() => setEnds((xs) => xs.slice(0, -1))}>Remove last</button>}
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor={`${kind}-from`}>From</label>
          <input id={`${kind}-from`} name="effective_from" type="date" required className={input} />
        </div>
        <button type="submit" disabled={pending} className={small}>{pending ? "Adding…" : "Add brackets"}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

/** Remove a rate that has not started yet. */
export function RemoveRate({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" disabled={pending} className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60"
        onClick={() => start(async () => { const r = await deleteRate(id); if (r.error) setError(r.error); })}>
        {pending ? "Removing…" : "Remove"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </>
  );
}
