"use client";

import { useActionState, useState } from "react";
import { input, small } from "@/components/form-styles";
import { saveNumbering, type Result } from "@/app/actions/settings";
import { today } from "@/lib/format";

const preview = (prefix: string, next: string, pad: string) => {
  const n = Number(next), p = Number(pad);
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(p) || p < 1 || p > 8) return "—";
  return prefix.replace("{YY}", today().slice(2, 4)) + String(n).padStart(p, "0");
};

export function NumberingRow({ type, name, prefix, next, pad, canEdit }: {
  type: string; name: string; prefix: string; next: number; pad: number; canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveNumbering, null as Result | null);
  const [p, setP] = useState(prefix);
  const [n, setN] = useState(String(next));
  const [d, setD] = useState(String(pad));

  return (
    <form action={action} className="grid items-end gap-3 px-5 py-3 sm:grid-cols-[10rem_1fr_6rem_5rem_auto]">
      <input type="hidden" name="type" value={type} />
      <div className="text-sm font-medium sm:self-center">
        {name}
        <p className="font-mono text-xs font-normal text-[var(--muted)]">Next: {preview(p, n, d)}</p>
      </div>
      <div>
        <label className="mb-1 block text-xs text-[var(--muted)]" htmlFor={`${type}-prefix`}>Prefix</label>
        <input id={`${type}-prefix`} name="prefix" value={p} onChange={(e) => setP(e.target.value)} disabled={!canEdit} className={`${input} font-mono`} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-[var(--muted)]" htmlFor={`${type}-next`}>Next number</label>
        <input id={`${type}-next`} name="next_number" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} disabled={!canEdit} className={`${input} tabular-nums`} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-[var(--muted)]" htmlFor={`${type}-pad`}>Digits</label>
        <input id={`${type}-pad`} name="pad" inputMode="numeric" value={d} onChange={(e) => setD(e.target.value)} disabled={!canEdit} className={`${input} tabular-nums`} />
      </div>
      <div className="flex items-center gap-2">
        {canEdit && <button type="submit" disabled={pending} className={small}>{pending ? "Saving…" : "Save"}</button>}
        {state?.error && <span className="text-xs text-red-700">{state.error}</span>}
        {state?.ok && <span className="text-xs text-[var(--muted)]">Saved</span>}
      </div>
    </form>
  );
}
