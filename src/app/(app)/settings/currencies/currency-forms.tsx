"use client";

import { useActionState, useState, useTransition } from "react";
import { input, small } from "@/components/form-styles";
import { addExchangeRate, saveCurrency, setCurrencyActive, type Result } from "@/app/actions/settings";
import { today } from "@/lib/format";

function Status({ state, done }: { state: Result | null; done: string }) {
  if (state?.error) return <p className="text-sm text-red-700">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-[var(--muted)]">{done}</p>;
  return null;
}

export function AddCurrency() {
  const [state, action, pending] = useActionState(saveCurrency, null as Result | null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] px-5 py-4">
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="cur-code">Code</label>
        <input id="cur-code" name="code" maxLength={3} required className={`${input} w-20 font-mono uppercase`} placeholder="EUR" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="cur-name">Name</label>
        <input id="cur-name" name="name" required className={`${input} w-56`} placeholder="Euro" />
      </div>
      <button type="submit" disabled={pending} className={small}>{pending ? "Adding…" : "Add currency"}</button>
      <Status state={state} done="Added." />
    </form>
  );
}

export function AddExchangeRate({ currencies }: { currencies: string[] }) {
  const [state, action, pending] = useActionState(addExchangeRate, null as Result | null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border-b border-[var(--border)] px-5 py-4">
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="fx-cur">Currency</label>
        <select id="fx-cur" name="currency" className={`${input} w-28`}>{currencies.map((c) => <option key={c}>{c}</option>)}</select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="fx-date">Date</label>
        <input id="fx-date" name="rate_date" type="date" required defaultValue={today()} className={input} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="fx-rate">MVR per unit</label>
        <input id="fx-rate" name="rate" inputMode="decimal" required className={`${input} w-32 tabular-nums`} placeholder="15.42" />
      </div>
      <button type="submit" disabled={pending} className={small}>{pending ? "Saving…" : "Save rate"}</button>
      <Status state={state} done="Saved." />
    </form>
  );
}

export function CurrencyToggle({ code, active, canEdit }: { code: string; active: boolean; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!canEdit) return <span className="text-xs">{active ? "Yes" : "No"}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <label className="inline-flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={active} disabled={pending}
          onChange={(e) => { const v = e.target.checked; start(async () => { const r = await setCurrencyActive(code, v); setError(r.error ?? null); }); }} />
        {active ? "Yes" : "No"}
      </label>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
