"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { input, label, primary } from "@/components/form-styles";
import { updateAccount, type Result } from "@/app/actions/accounts";

type Account = { id: string; code: string; name: string; type: string; is_system: boolean; active: boolean; description: string | null; budget_category: string | null };

export function EditAccount({ account: a }: { account: Account }) {
  const [state, action, pending] = useActionState(updateAccount, null as Result | null);
  return (
    <Card>
      <CardHeader title="Details" subtitle={a.is_system ? "A system account keeps its code, type and purpose; its name and description can change" : undefined} />
      <form action={action} className="grid gap-4 px-5 py-5 sm:grid-cols-3">
        <input type="hidden" name="id" value={a.id} />
        <div>
          <label htmlFor="ed-code" className={label}>Code</label>
          <input id="ed-code" name="code" defaultValue={a.code} disabled={a.is_system} className={`${input} font-mono`} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ed-name" className={label}>Name</label>
          <input id="ed-name" name="name" required defaultValue={a.name} className={input} />
        </div>
        {a.type === "cogs" && (
          <div>
            <label htmlFor="ed-cat" className={label}>Counts against budget</label>
            <select id="ed-cat" name="budget_category" defaultValue={a.budget_category ?? "other"} className={input}>
              {["materials", "subcontractors", "labour", "equipment", "freight", "site", "other"].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
        )}
        <div className={a.type === "cogs" ? "sm:col-span-2" : "sm:col-span-3"}>
          <label htmlFor="ed-desc" className={label}>Description</label>
          <input id="ed-desc" name="description" defaultValue={a.description ?? ""} className={input} />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input type="checkbox" name="active" defaultChecked={a.active} className="h-4 w-4" />
          Active <span className="text-xs text-[var(--muted)]">— an inactive account is hidden from pickers; it must have no balance</span>
        </label>
        <div className="flex items-center gap-3 sm:col-span-3">
          <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Save"}</button>
          {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
          {state?.ok && <p className="text-sm text-[var(--muted)]">Saved.</p>}
        </div>
      </form>
    </Card>
  );
}
