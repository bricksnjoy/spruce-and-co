"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui";
import { input, label, primary } from "@/components/form-styles";
import { saveEmployee, type Result } from "@/app/actions/payroll";

export type Employee = {
  id?: string; name: string; job_title: string | null; department: string; nationality_type: string; basic_salary: string;
  pension_eligible: boolean; wht_applicable: boolean; bank_name: string | null; bank_account: string | null; start_date: string | null;
  end_date: string | null; permit_no: string | null; permit_expiry: string | null; passport_no: string | null; phone: string | null; email: string | null; active: boolean;
};
export const blankEmployee: Employee = { name: "", job_title: null, department: "site", nationality_type: "maldivian", basic_salary: "", pension_eligible: true,
  wht_applicable: true, bank_name: null, bank_account: null, start_date: null, end_date: null, permit_no: null, permit_expiry: null, passport_no: null, phone: null, email: null, active: true };

export function EmployeeForm({ e, onDone }: { e: Employee; onDone?: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveEmployee, null as Result | null);
  useEffect(() => { if (state?.ok && state.id && !e.id) router.push(`/payroll/employees/${state.id}`); }, [state, e.id, router]);
  const f = (k: keyof Employee) => (e[k] == null ? "" : String(e[k]));
  return (
    <form onSubmit={(ev) => { ev.preventDefault(); const fd = new FormData(ev.currentTarget); startTransition(() => action(fd)); }} className="grid gap-4 sm:grid-cols-3">
      {e.id && <input type="hidden" name="id" value={e.id} />}
      <div className="sm:col-span-2"><label htmlFor="em-name" className={label}>Name</label><input id="em-name" name="name" required defaultValue={e.name} className={input} /></div>
      <div><label htmlFor="em-title" className={label}>Job title</label><input id="em-title" name="job_title" defaultValue={f("job_title")} className={input} /></div>
      <div><label htmlFor="em-dept" className={label}>Works on</label>
        <select id="em-dept" name="department" defaultValue={e.department} className={input}><option value="site">Site (cost goes to projects)</option><option value="admin">Admin (overhead)</option></select></div>
      <div><label htmlFor="em-nat" className={label}>Nationality</label>
        <select id="em-nat" name="nationality_type" defaultValue={e.nationality_type} className={input}><option value="maldivian">Maldivian</option><option value="expatriate">Expatriate</option></select></div>
      <div><label htmlFor="em-basic" className={label}>Basic salary (MVR a month)</label><input id="em-basic" name="basic_salary" inputMode="decimal" required defaultValue={f("basic_salary")} className={`${input} tabular-nums`} /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pension_eligible" defaultChecked={e.pension_eligible} className="h-4 w-4" /> Pension applies (Maldivian staff)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="wht_applicable" defaultChecked={e.wht_applicable} className="h-4 w-4" /> Withholding tax applies</label>
      {e.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={e.active} className="h-4 w-4" /> Still employed</label>}
      <div><label htmlFor="em-start" className={label}>Started</label><input id="em-start" name="start_date" type="date" defaultValue={f("start_date")} className={input} /></div>
      <div><label htmlFor="em-end" className={label}>Left</label><input id="em-end" name="end_date" type="date" defaultValue={f("end_date")} className={input} /></div>
      <div><label htmlFor="em-phone" className={label}>Phone</label><input id="em-phone" name="phone" type="tel" defaultValue={f("phone")} className={input} /></div>
      <div><label htmlFor="em-email" className={label}>Email</label><input id="em-email" name="email" type="email" defaultValue={f("email")} className={input} /></div>
      <div><label htmlFor="em-bank" className={label}>Bank</label><input id="em-bank" name="bank_name" defaultValue={f("bank_name")} className={input} placeholder="BML" /></div>
      <div><label htmlFor="em-acct" className={label}>Account number</label><input id="em-acct" name="bank_account" defaultValue={f("bank_account")} className={`${input} font-mono`} /></div>
      <div><label htmlFor="em-permit" className={label}>Work permit no.</label><input id="em-permit" name="permit_no" defaultValue={f("permit_no")} className={input} /></div>
      <div><label htmlFor="em-pexp" className={label}>Permit expires</label><input id="em-pexp" name="permit_expiry" type="date" defaultValue={f("permit_expiry")} className={input} /></div>
      <div><label htmlFor="em-pass" className={label}>Passport no.</label><input id="em-pass" name="passport_no" defaultValue={f("passport_no")} className={input} /></div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : e.id ? "Save" : "Add employee"}</button>
        {onDone && <button type="button" onClick={onDone} className="text-sm text-[var(--muted)] hover:underline">Cancel</button>}
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && e.id && <p className="text-sm text-[var(--muted)]">Saved.</p>}
      </div>
    </form>
  );
}

export function NewEmployee() {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={primary}>New employee</button>;
  return <Card><CardHeader title="New employee" /><div className="px-5 py-5"><EmployeeForm e={blankEmployee} onDone={() => setOpen(false)} /></div></Card>;
}
