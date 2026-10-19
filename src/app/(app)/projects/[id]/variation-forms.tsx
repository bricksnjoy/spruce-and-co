"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { Badge, Card, CardHeader, Table, Th, Td } from "@/components/ui";
import { input, small, primary } from "@/components/form-styles";
import { addVariation, setVariationStatus, type Result } from "@/app/actions/project-value";
import { date, money, today } from "@/lib/format";

export type VariationRow = {
  id: string; number: number | null; ref: string; title: string; description: string | null; status: string;
  amount: number | null; raised_date: string; approved_date: string | null; time_impact_days: number; client_reference: string | null;
};

export function NewVariation({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (p: Result | null, fd: FormData) => {
    const r = await addVariation(p, fd);
    if (r.ok) setOpen(false);
    return r;
  }, null as Result | null);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={primary}>Raise a variation</button>;
  return (
    <Card>
      <CardHeader title="Raise a variation" subtitle="Recorded as submitted; approve it once the client agrees" />
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}
        className="grid gap-4 px-5 py-5 sm:grid-cols-3">
        <input type="hidden" name="project_id" value={projectId} />
        <div className="sm:col-span-2"><label className="mb-1.5 block text-sm font-medium" htmlFor="vo-title">What changes</label>
          <input id="vo-title" name="title" required className={input} placeholder="Extra partition wall, level 2" /></div>
        <div><label className="mb-1.5 block text-sm font-medium" htmlFor="vo-amount">Amount (MVR)</label>
          <input id="vo-amount" name="amount" inputMode="decimal" required className={`${input} tabular-nums`} placeholder="Negative for an omission" /></div>
        <div><label className="mb-1.5 block text-sm font-medium" htmlFor="vo-date">Raised on</label>
          <input id="vo-date" name="raised_date" type="date" required defaultValue={today()} className={input} /></div>
        <div><label className="mb-1.5 block text-sm font-medium" htmlFor="vo-days">Time impact (days)</label>
          <input id="vo-days" name="time_impact_days" inputMode="numeric" className={input} placeholder="0" /></div>
        <div><label className="mb-1.5 block text-sm font-medium" htmlFor="vo-ref">Client&apos;s reference</label>
          <input id="vo-ref" name="client_reference" className={input} /></div>
        <div className="sm:col-span-3"><label className="mb-1.5 block text-sm font-medium" htmlFor="vo-desc">Details</label>
          <textarea id="vo-desc" name="description" rows={2} className={input} /></div>
        <div className="flex items-center gap-3 sm:col-span-3">
          <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Raise variation"}</button>
          <button type="button" onClick={() => setOpen(false)} className="text-sm text-[var(--muted)] hover:underline">Cancel</button>
          {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        </div>
      </form>
    </Card>
  );
}

function Actions({ projectId, v }: { projectId: string; v: VariationRow }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [when, setWhen] = useState(today());
  const run = (st: "approved" | "rejected" | "cancelled" | "submitted") =>
    start(async () => { const r = await setVariationStatus(projectId, v.id, st, when); setError(r.error ?? null); if (!r.error) setApproving(false); });
  if (v.status === "approved" || v.status === "rejected" || v.status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <button type="button" disabled={pending} onClick={() => run("submitted")} className="font-medium text-[var(--brand)] hover:underline">Reopen</button>
        {error && <span className="text-red-700">{error}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2 text-xs">
      {approving ? (
        <>
          <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Approved on" className={`${input} w-36 py-1 text-xs`} />
          <button type="button" disabled={pending} onClick={() => run("approved")} className={small}>Approve</button>
          <button type="button" onClick={() => setApproving(false)} className="text-[var(--muted)] hover:underline">Cancel</button>
        </>
      ) : (
        <>
          <button type="button" disabled={pending} onClick={() => setApproving(true)} className="font-medium text-emerald-700 hover:underline">Approve…</button>
          <button type="button" disabled={pending} onClick={() => run("rejected")} className="font-medium text-red-700 hover:underline">Reject</button>
          <button type="button" disabled={pending} onClick={() => run("cancelled")} className="text-[var(--muted)] hover:underline">Withdraw</button>
        </>
      )}
      {error && <span className="text-red-700">{error}</span>}
    </span>
  );
}

export function VariationRows({ projectId, rows, canEdit }: { projectId: string; rows: VariationRow[]; canEdit: boolean }) {
  return (
    <Table>
      <thead><tr><Th>Ref</Th><Th>Variation</Th><Th>Raised</Th><Th>Status</Th><Th right>Amount</Th>{canEdit && <Th right> </Th>}</tr></thead>
      <tbody>
        {rows.map((v) => (
          <tr key={v.id}>
            <Td className="font-mono text-xs">{v.ref}</Td>
            <Td>
              {v.title}
              {(v.description || v.client_reference || v.time_impact_days) ? (
                <p className="text-xs text-[var(--muted)]">{[v.description, v.client_reference && `Client ref ${v.client_reference}`, v.time_impact_days ? `${v.time_impact_days} days` : null].filter(Boolean).join(" · ")}</p>
              ) : null}
            </Td>
            <Td className="whitespace-nowrap">{date(v.raised_date)}</Td>
            <Td><Badge value={v.status} />{v.approved_date && <p className="text-xs text-[var(--muted)]">{date(v.approved_date)}</p>}</Td>
            <Td right className={v.status === "approved" ? "font-medium" : "text-[var(--muted)]"}>{money(Number(v.amount ?? 0))}</Td>
            {canEdit && <Td right><Actions projectId={projectId} v={v} /></Td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
