"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { Card, CardHeader, Table, Th, Td } from "@/components/ui";
import { input, small } from "@/components/form-styles";
import { deleteBudgetLine, saveBudgetLine, type Result } from "@/app/actions/project-value";
import { money } from "@/lib/format";

export type BudgetLine = {
  id: string; description: string; budget_category: string | null; budget_amount: number;
  revised_amount: number | null; forecast_to_complete: number | null;
};
const CATS = ["materials", "subcontractors", "labour", "equipment", "freight", "site", "other"];
const cap = (c: string) => c[0].toUpperCase() + c.slice(1);

function LineForm({ projectId, line, onDone }: { projectId: string; line?: BudgetLine; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (p: Result | null, fd: FormData) => {
    const r = await saveBudgetLine(p, fd);
    if (r.ok) onDone?.();
    return r;
  }, null as Result | null);
  const v = (x: number | null | undefined) => (x == null ? "" : String(x));
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}
      className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_8rem_8rem_8rem_auto]">
      <input type="hidden" name="project_id" value={projectId} />
      {line && <input type="hidden" name="id" value={line.id} />}
      <div><label className="mb-1 block text-xs text-[var(--muted)]">Description</label>
        <input name="description" required defaultValue={line?.description ?? ""} className={input} /></div>
      <div><label className="mb-1 block text-xs text-[var(--muted)]">Category</label>
        <select name="budget_category" defaultValue={line?.budget_category ?? "materials"} className={input}>
          {CATS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
        </select></div>
      <div><label className="mb-1 block text-xs text-[var(--muted)]">Budget</label>
        <input name="budget_amount" inputMode="decimal" required defaultValue={v(line?.budget_amount)} className={`${input} tabular-nums`} /></div>
      <div><label className="mb-1 block text-xs text-[var(--muted)]">Revised</label>
        <input name="revised_amount" inputMode="decimal" defaultValue={v(line?.revised_amount)} placeholder="Same" className={`${input} tabular-nums`} /></div>
      <div><label className="mb-1 block text-xs text-[var(--muted)]">To complete</label>
        <input name="forecast_to_complete" inputMode="decimal" defaultValue={v(line?.forecast_to_complete)} placeholder="Auto" className={`${input} tabular-nums`} /></div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={small}>{pending ? "Saving…" : line ? "Save" : "Add"}</button>
        {onDone && line && <button type="button" onClick={onDone} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>}
      </div>
      {state?.error && <p className="text-xs text-red-700 sm:col-span-6">{state.error}</p>}
    </form>
  );
}

export function BudgetEditor({ projectId, lines, canEdit }: { projectId: string; lines: BudgetLine[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Budget lines" subtitle="Blank revised = same as budget. Blank to complete = revised budget less actual cost." />
      {lines.length > 0 && (
        <Table>
          <thead><tr><Th>Description</Th><Th>Category</Th><Th right>Budget</Th><Th right>Revised</Th><Th right>To complete</Th>{canEdit && <Th right> </Th>}</tr></thead>
          <tbody>
            {lines.map((l) => editing === l.id ? (
              <tr key={l.id}><Td colSpan={6}><LineForm projectId={projectId} line={l} onDone={() => setEditing(null)} /></Td></tr>
            ) : (
              <tr key={l.id}>
                <Td>{l.description}</Td>
                <Td>{l.budget_category ? cap(l.budget_category) : <span className="text-amber-700">Other (no category)</span>}</Td>
                <Td right>{money(Number(l.budget_amount))}</Td>
                <Td right>{l.revised_amount == null ? <span className="text-[var(--muted)]">—</span> : money(Number(l.revised_amount))}</Td>
                <Td right>{l.forecast_to_complete == null ? <span className="text-[var(--muted)]">auto</span> : money(Number(l.forecast_to_complete))}</Td>
                {canEdit && (
                  <Td right>
                    <span className="inline-flex gap-3 text-xs">
                      <button type="button" onClick={() => setEditing(l.id)} className="font-medium text-[var(--brand)] hover:underline">Edit</button>
                      <button type="button" disabled={pending} className="font-medium text-red-700 hover:underline"
                        onClick={() => start(async () => { const r = await deleteBudgetLine(projectId, l.id); setError(r.error ?? null); })}>Delete</button>
                    </span>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {error && <p className="px-5 py-2 text-sm text-red-700">{error}</p>}
      {canEdit && <div className="border-t border-[var(--border)] px-5 py-4"><LineForm key={lines.length} projectId={projectId} /></div>}
    </Card>
  );
}
