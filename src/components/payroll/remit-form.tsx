"use client";

import { startTransition, useActionState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { input, label, primary } from "@/components/form-styles";
import { remit, type Result } from "@/app/actions/payroll";
import { today } from "@/lib/format";

export function RemitForm({ accounts, banks }: { accounts: { id: string; name: string; owed: string }[]; banks: { id: string; code: string; name: string }[] }) {
  const [state, action, pending] = useActionState(remit, null as Result | null);
  return (
    <Card>
      <CardHeader title="Pay it over" />
      <form key={state?.id ?? "new"} onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="grid gap-4 px-5 py-5 sm:grid-cols-3">
        <div><label htmlFor="rm-acct" className={label}>What</label>
          <select id="rm-acct" name="account_id" required defaultValue="" className={input}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div><label htmlFor="rm-amt" className={label}>Amount</label><input id="rm-amt" name="amount" inputMode="decimal" required className={`${input} tabular-nums`} /></div>
        <div><label htmlFor="rm-date" className={label}>Paid on</label><input id="rm-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
        <div><label htmlFor="rm-bank" className={label}>Paid from</label>
          <select id="rm-bank" name="bank_account_id" required defaultValue="" className={input}><option value="">Choose…</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></div>
        <div><label htmlFor="rm-ref" className={label}>Reference</label><input id="rm-ref" name="reference" className={input} placeholder="Receipt no." /></div>
        <div><label htmlFor="rm-memo" className={label}>Period</label><input id="rm-memo" name="memo" className={input} placeholder="e.g. March 2026" /></div>
        <div className="flex items-center gap-3 sm:col-span-3">
          <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Record payment"}</button>
          {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
          {state?.ok && <p className="text-sm text-[var(--muted)]">Recorded.</p>}
        </div>
      </form>
    </Card>
  );
}
