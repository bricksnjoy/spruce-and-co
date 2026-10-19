"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { input, label, primary } from "@/components/form-styles";
import { createAccount, type Result } from "@/app/actions/accounts";

type Parent = { id: string; code: string; name: string; type: string };
const TYPES: [string, string][] = [
  ["expense", "Expense"], ["cogs", "Cost of sales (job cost)"], ["income", "Income"],
  ["asset", "Asset"], ["liability", "Liability"], ["equity", "Equity"],
];

export function NewAccount({ parents }: { parents: Parent[] }) {
  const [state, action, pending] = useActionState(createAccount, null as Result | null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("expense");
  const [kind, setKind] = useState("other");

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={primary}>New account</button>;
  }
  return (
    <Card>
      <CardHeader title="New account" subtitle="Added to the chart for both books" />
      <form action={action} className="grid gap-4 px-5 py-5 sm:grid-cols-3">
        <div>
          <label htmlFor="acc-type" className={label}>Type</label>
          <select id="acc-type" name="type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="acc-code" className={label}>Code</label>
          <input id="acc-code" name="code" required className={`${input} font-mono`} placeholder="6150" />
        </div>
        <div>
          <label htmlFor="acc-name" className={label}>Name</label>
          <input id="acc-name" name="name" required className={input} />
        </div>
        {type === "asset" && (
          <div>
            <label htmlFor="acc-kind" className={label}>Kind</label>
            <select id="acc-kind" name="asset_kind" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
              <option value="other">Other asset</option>
              <option value="bank">Bank account</option>
              <option value="fixed_asset">Fixed asset</option>
            </select>
          </div>
        )}
        {type === "asset" && kind === "bank" && (
          <div>
            <label htmlFor="acc-cur" className={label}>Currency</label>
            <select id="acc-cur" name="currency" className={input}><option>MVR</option><option>USD</option></select>
          </div>
        )}
        {type === "cogs" && (
          <div>
            <label htmlFor="acc-cat" className={label}>Counts against budget</label>
            <select id="acc-cat" name="budget_category" className={input}>
              {["materials", "subcontractors", "labour", "equipment", "freight", "site", "other"].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="acc-parent" className={label}>Sub-account of</label>
          <select id="acc-parent" name="parent_id" className={input} defaultValue="">
            <option value="">— none —</option>
            {parents.filter((p) => p.type === type).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="acc-desc" className={label}>Description</label>
          <input id="acc-desc" name="description" className={input} />
        </div>
        <div className="flex items-center gap-3 sm:col-span-3">
          <button type="submit" disabled={pending} className={primary}>{pending ? "Adding…" : "Add account"}</button>
          <button type="button" onClick={() => setOpen(false)} className="text-sm text-[var(--muted)] hover:underline">Close</button>
          {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
          {state?.ok && <p className="text-sm text-[var(--muted)]">Added.</p>}
        </div>
      </form>
    </Card>
  );
}
