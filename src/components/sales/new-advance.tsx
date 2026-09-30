"use client";

import { startTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui";
import { input, label, primary } from "@/components/form-styles";
import { receiveAdvance, type Result } from "@/app/actions/sales";
import { today } from "@/lib/format";

export function NewAdvance({ customers, projects, banks }: {
  customers: { id: string; name: string }[]; projects: { id: string; code: string; name: string }[]; banks: { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(receiveAdvance, null as Result | null);
  const router = useRouter();
  useEffect(() => { if (state?.ok && state.id) router.push(`/sales/${state.id}`); }, [state, router]);
  return (
    <Card>
      <CardHeader title="Receive an advance" />
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="grid gap-4 px-5 py-5 sm:grid-cols-3">
        <div><label htmlFor="a-cust" className={label}>Customer</label>
          <select id="a-cust" name="contact_id" required className={input} defaultValue=""><option value="">Choose…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label htmlFor="a-proj" className={label}>Project</label>
          <select id="a-proj" name="project_id" className={input} defaultValue=""><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></div>
        <div><label htmlFor="a-date" className={label}>Date</label><input id="a-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
        <div><label htmlFor="a-amt" className={label}>Amount</label><input id="a-amt" name="total_amount" inputMode="decimal" required className={`${input} tabular-nums`} /></div>
        <div><label htmlFor="a-bank" className={label}>Paid into</label>
          <select id="a-bank" name="bank_account_id" required className={input} defaultValue=""><option value="">Choose…</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></div>
        <div><label htmlFor="a-ref" className={label}>Reference</label><input id="a-ref" name="reference" className={input} /></div>
        <div className="flex items-center gap-3 sm:col-span-3">
          <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Save advance"}</button>
          {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        </div>
      </form>
    </Card>
  );
}
