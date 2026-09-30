"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { input, label, primary } from "@/components/form-styles";
import { deleteRule, saveRule, toggleRule, type Result } from "@/app/actions/banking";

type Opt = { id: string; name: string };
type Acct = { id: string; code: string; name: string };

export function RuleForm({ accounts, contacts, projects }: { accounts: Acct[]; contacts: Opt[]; projects: { id: string; code: string }[] }) {
  const [state, action, pending] = useActionState(saveRule, null as Result | null);
  return (
    <form key={state?.ok ? `r-${state.id ?? "ok"}` : "r"} onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}
      className="grid gap-3 px-5 py-4 sm:grid-cols-3">
      <div><label htmlFor="ru-name" className={label}>Rule name</label><input id="ru-name" name="name" required className={input} /></div>
      <div><label htmlFor="ru-contains" className={label}>Description contains</label><input id="ru-contains" name="contains" className={input} placeholder="e.g. DHIRAAGU" /></div>
      <div><label htmlFor="ru-dir" className={label}>Money</label>
        <select id="ru-dir" name="direction" defaultValue="any" className={input}><option value="any">In or out</option><option value="in">In</option><option value="out">Out</option></select></div>
      <div><label htmlFor="ru-min" className={label}>Amount from</label><input id="ru-min" name="min_amount" inputMode="decimal" className={`${input} tabular-nums`} /></div>
      <div><label htmlFor="ru-max" className={label}>Amount up to</label><input id="ru-max" name="max_amount" inputMode="decimal" className={`${input} tabular-nums`} /></div>
      <div><label htmlFor="ru-pr" className={label}>Priority (lower wins)</label><input id="ru-pr" name="priority" inputMode="numeric" defaultValue="100" className={input} /></div>
      <div><label htmlFor="ru-acct" className={label}>Post to account</label>
        <select id="ru-acct" name="account_id" required defaultValue="" className={input}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
      <div><label htmlFor="ru-contact" className={label}>Name (optional)</label>
        <select id="ru-contact" name="contact_id" defaultValue="" className={input}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label htmlFor="ru-proj" className={label}>Project (optional)</label>
        <select id="ru-proj" name="project_id" defaultValue="" className={input}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Add rule"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && <p className="text-sm text-[var(--muted)]">Saved.</p>}
      </div>
    </form>
  );
}

export function RuleActions({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-3">
      <button type="button" disabled={pending} className="text-xs font-medium text-[var(--brand)] hover:underline"
        onClick={() => start(async () => { const r = await toggleRule(id, !active); setError(r.error ?? null); })}>{active ? "Turn off" : "Turn on"}</button>
      <button type="button" disabled={pending} className="text-xs text-red-700 hover:underline"
        onClick={() => { if (confirm("Delete this rule? Lines already added stay as they are.")) start(async () => { const r = await deleteRule(id); setError(r.error ?? null); }); }}>Delete</button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
