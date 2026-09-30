"use client";

import { startTransition, useActionState } from "react";
import { input, label, primary } from "@/components/form-styles";
import { fileReturn, payReturn, type Result } from "@/app/actions/taxes";
import { today } from "@/lib/format";

const submit = (action: (fd: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd));
};

export function FileReturnForm({ periodId, net }: { periodId: string; net: string }) {
  const [state, action, pending] = useActionState(fileReturn, null as Result | null);
  return (
    <form onSubmit={submit(action)} className="space-y-3 px-5 py-4">
      <input type="hidden" name="period_id" value={periodId} />
      <div className="max-w-sm"><label htmlFor="fr-ref" className={label}>MIRA return reference (optional)</label><input id="fr-ref" name="reference" className={input} /></div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-0.5" />
        <span>I have filed this return with MIRA showing a net of <strong className="tabular-nums">{net}</strong>. Filing here locks the return: later changes to its documents go into the next return.</span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Filing…" : "File return"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </div>
    </form>
  );
}

export function PayReturnForm({ periodId, owed, banks }: { periodId: string; owed: string; banks: { id: string; code: string; name: string }[] }) {
  const [state, action, pending] = useActionState(payReturn, null as Result | null);
  return (
    <form key={state?.id ?? "p"} onSubmit={submit(action)} className="grid gap-3 px-5 py-4 sm:grid-cols-3">
      <input type="hidden" name="period_id" value={periodId} />
      <div><label htmlFor="pr-bank" className={label}>Paid from</label>
        <select id="pr-bank" name="bank_id" required defaultValue="" className={input}><option value="">Choose…</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></div>
      <div><label htmlFor="pr-date" className={label}>Date</label><input id="pr-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
      <div><label htmlFor="pr-amt" className={label}>Amount</label><input id="pr-amt" name="amount" inputMode="decimal" defaultValue={owed} className={`${input} tabular-nums`} /></div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Record payment"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && <p className="text-sm text-[var(--muted)]">Recorded.</p>}
      </div>
    </form>
  );
}
