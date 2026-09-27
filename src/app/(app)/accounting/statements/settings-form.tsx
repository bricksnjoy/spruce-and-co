"use client";

import { useActionState } from "react";
import { saveStatementSettings, type StatementSettingsResult } from "@/app/actions/statements";
import type { StatementSettings } from "@/lib/statements";

const field = "mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 text-sm text-[var(--text)]";

export function StatementSettingsForm({ s }: { s: StatementSettings }) {
  const [state, action, pending] = useActionState<StatementSettingsResult | null, FormData>(saveStatementSettings, null);
  return (
    <form action={action} className="space-y-3 px-5 py-4 text-xs text-[var(--muted)]">
      <div className="grid grid-cols-2 gap-3">
        <label>Share capital (MVR)
          <input name="share_capital" inputMode="decimal" defaultValue={s.share_capital || ""} placeholder="0" className={field} />
        </label>
        <label>Paid in on
          <input name="share_capital_date" type="date" defaultValue={s.share_capital_date ?? ""} className={field} />
        </label>
        <label>Cash at the start (MVR)
          <input name="opening_cash" inputMode="decimal" defaultValue={s.opening_cash || ""} placeholder="0" className={field} />
        </label>
        <label>Equipment life (years)
          <input name="asset_life_years" inputMode="numeric" defaultValue={s.asset_life_years} className={field} />
        </label>
        <label>Business profit tax (%)
          <input name="bpt_rate" inputMode="decimal" defaultValue={s.bpt_rate} className={field} />
        </label>
        <label>Tax-free profit (MVR)
          <input name="bpt_threshold" inputMode="decimal" defaultValue={s.bpt_threshold} className={field} />
        </label>
      </div>
      <p>Cash at the start is money the company held before the first record in the app, such as the opening bank balance.</p>
      {state?.error && <p className="text-red-700">{state.error}</p>}
      {state?.ok && <p className="text-emerald-700">Saved. The statements are updated.</p>}
      <button type="submit" disabled={pending}
        className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
