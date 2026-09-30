"use client";

import { startTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { input, label, primary } from "@/components/form-styles";
import { createRun, type Result } from "@/app/actions/payroll";
import { today } from "@/lib/format";

export function NewRun() {
  const router = useRouter();
  const [state, action, pending] = useActionState(createRun, null as Result | null);
  useEffect(() => { if (state?.ok && state.id) router.push(`/payroll/runs/${state.id}`); }, [state, router]);
  const t = today();
  return (
    <Card>
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="flex flex-wrap items-end gap-3 px-5 py-4">
        <div><label htmlFor="r-month" className={label}>Month</label><input id="r-month" name="month" type="month" required defaultValue={t.slice(0, 7)} className={input} /></div>
        <div><label htmlFor="r-pay" className={label}>Pay date</label><input id="r-pay" name="pay_date" type="date" required defaultValue={t} className={input} /></div>
        <button type="submit" disabled={pending} className={primary}>{pending ? "Starting…" : "Start payroll run"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        <p className="w-full text-xs text-[var(--muted)]">Every active employee gets a payslip, pre-filled with their salary, standing allowances, project split and any advance recovery.</p>
      </form>
    </Card>
  );
}
