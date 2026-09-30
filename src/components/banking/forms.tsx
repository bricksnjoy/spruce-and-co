"use client";

import { startTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { input, label, primary } from "@/components/form-styles";
import { importStatement, transfer, type Result } from "@/app/actions/banking";
import { today } from "@/lib/format";

type Acct = { id: string; code: string; name: string };
const submit = (action: (fd: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd));
};

export function ImportForm({ accounts, account }: { accounts: Acct[]; account?: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(importStatement, null as Result | null);
  useEffect(() => { if (state?.ok && state.id && !account) router.push(`/banking/${state.id}?note=${encodeURIComponent(state.note ?? "")}`); }, [state, router, account]);
  return (
    <form onSubmit={submit(action)} className="grid gap-3 px-5 py-4 sm:grid-cols-2">
      {account ? <input type="hidden" name="account_id" value={account} /> : (
        <div><label htmlFor="im-acct" className={label}>Account</label>
          <select id="im-acct" name="account_id" required defaultValue="" className={input}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
      )}
      <div><label htmlFor="im-file" className={label}>Statement (CSV)</label><input id="im-file" name="file" type="file" accept=".csv,text/csv" required className="text-sm" /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Reading…" : "Import"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && account && <p className="text-sm text-[var(--muted)]">{state.note}</p>}
      </div>
    </form>
  );
}

export function TransferForm({ accounts }: { accounts: Acct[] }) {
  const [state, action, pending] = useActionState(transfer, null as Result | null);
  return (
    <form key={state?.id ?? "t"} onSubmit={submit(action)} className="grid gap-3 px-5 py-4 sm:grid-cols-2">
      <div><label htmlFor="tr-from" className={label}>From</label>
        <select id="tr-from" name="from" required defaultValue="" className={input}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
      <div><label htmlFor="tr-to" className={label}>To</label>
        <select id="tr-to" name="to" required defaultValue="" className={input}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
      <div><label htmlFor="tr-amt" className={label}>Amount</label><input id="tr-amt" name="amount" inputMode="decimal" required className={`${input} tabular-nums`} /></div>
      <div><label htmlFor="tr-date" className={label}>Date</label><input id="tr-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
      <div className="sm:col-span-2"><label htmlFor="tr-memo" className={label}>Note</label><input id="tr-memo" name="memo" className={input} /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Record transfer"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && <p className="text-sm text-[var(--muted)]">Recorded.</p>}
      </div>
    </form>
  );
}
