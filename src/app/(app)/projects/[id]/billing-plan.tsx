"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { Card, CardHeader, Empty, Table, Th, Td } from "@/components/ui";
import { input, small } from "@/components/form-styles";
import { deleteBillingStage, saveBillingStage, type Result } from "@/app/actions/project-value";
import { invoiceStage } from "@/app/actions/sales";
import { DeleteInvoiceButton } from "@/components/sales/delete-invoice";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { today } from "@/lib/format";
import { money } from "@/lib/format";
import { dbToLaari, laariToNumber, percentOf } from "@/lib/money";

export type Stage = {
  id: string; name: string; basis: "percent" | "amount"; value: number | string; due_event: string | null; invoice_id: string | null;
  // what its invoice says, once invoiced (and not voided)
  invoice_total?: string | null;
  // the GST its invoice actually charged
  invoice_gst?: string | null;
  invoice_number?: string | null;
  // what has been paid on its invoice
  invoice_paid?: number;
};

/** The progress-billing plan: stages that become invoices (in the Sales module). */
export function BillingPlan({ projectId, revised, stages, canEdit, gstRate = "0" }: {
  projectId: string; revised: string; stages: Stage[]; canEdit: boolean;
  // the GST added on top of each stage when invoiced ("0" when none)
  gstRate?: string;
}) {
  const contract = dbToLaari(revised);
  const plannedOf = (st: Stage) => (st.basis === "percent" ? percentOf(contract, String(st.value)) : dbToLaari(st.value));
  // an invoiced stage counts at its invoice's amount
  const amountOf = (st: Stage) => (st.invoice_total != null ? dbToLaari(st.invoice_total) : plannedOf(st));
  const planned = stages.reduce((t, st) => t + amountOf(st), 0n);
  const gstOf = (v: bigint) => percentOf(v, gstRate);
  // an invoiced stage shows the GST its invoice charged; a planned one, the GST it will carry
  const stageGst = (st: Stage) => (st.invoice_gst != null ? dbToLaari(st.invoice_gst) : gstOf(amountOf(st)));
  const hasGst = gstRate !== "0";
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [state, action, saving] = useActionState(saveBillingStage, null as Result | null);
  const [basis, setBasis] = useState<"percent" | "amount">("percent");
  const router = useRouter();
  const invoice = (stageId: string) => start(async () => {
    const r = await invoiceStage(stageId, today());
    if (r.error) setError(r.error); else if (r.id) router.push(`/sales/${r.id}/edit`);
  });

  return (
    <Card>
      <CardHeader title="Billing plan" subtitle={`Planned ${money(laariToNumber(planned))} of a ${money(laariToNumber(contract))} contract${hasGst ? `, before GST · with ${Number(gstRate)}% GST the client pays ${money(laariToNumber(contract + gstOf(contract)))}` : ""}`} />
      {planned !== contract && stages.length > 0 && (
        <p className={`mx-5 mt-4 rounded-lg px-4 py-2 text-sm ${planned > contract ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
          {planned > contract ? `The plan bills ${money(laariToNumber(planned - contract))} more than the contract.` : `${money(laariToNumber(contract - planned))} of the contract is not in the plan yet.`}
        </p>
      )}
      {stages.length === 0 ? <Empty message="No billing stages yet." /> : (
        <Table>
          <thead><tr><Th>Stage</Th><Th>When</Th><Th right>Share</Th><Th right>{hasGst ? "Before GST" : "Amount"}</Th>{hasGst && <><Th right>GST {Number(gstRate)}%</Th><Th right>With GST</Th></>}<Th right>Invoiced</Th>{canEdit && <Th right> </Th>}</tr></thead>
          <tbody>
            {stages.map((st) => (
              <tr key={st.id}>
                <Td>{st.name}</Td>
                <Td className="text-xs text-[var(--muted)]">{st.due_event ?? ""}</Td>
                <Td right>{st.basis === "percent" ? `${Number(st.value)}%` : "Fixed"}</Td>
                <Td right>{money(laariToNumber(amountOf(st)))}
                  {amountOf(st) !== plannedOf(st) && <span className="block text-xs text-[var(--muted)]">planned {money(laariToNumber(plannedOf(st)))}</span>}</Td>
                {hasGst && <>
                  <Td right>{money(laariToNumber(stageGst(st)))}
                    {st.invoice_gst != null && stageGst(st) !== gstOf(amountOf(st)) && (
                      <span className="block text-xs font-medium text-amber-700">should be {money(laariToNumber(gstOf(amountOf(st))))}: fix the invoice&apos;s GST code</span>
                    )}</Td>
                  <Td right className="font-medium">{money(laariToNumber(amountOf(st) + stageGst(st)))}</Td>
                </>}
                <Td right>{st.invoice_id ? (
                  <span className="inline-flex flex-col items-end gap-1">
                    <Link href={`/sales/${st.invoice_id}`} className="font-medium text-[var(--brand)] hover:underline">View invoice</Link>
                    {canEdit && <DeleteInvoiceButton id={st.invoice_id} number={st.invoice_number ?? null} paid={st.invoice_paid ?? 0} label="Delete invoice" />}
                  </span>
                )
                  : canEdit ? <button type="button" disabled={pending} onClick={() => invoice(st.id)} className="text-xs font-medium text-[var(--brand)] hover:underline">Create invoice</button>
                  : <span className="text-[var(--muted)]">Not yet</span>}</Td>
                {canEdit && (
                  <Td right>
                    {!st.invoice_id && (
                      <button type="button" disabled={pending} className="text-xs font-medium text-red-700 hover:underline"
                        onClick={() => start(async () => { const r = await deleteBillingStage(projectId, st.id); setError(r.error ?? null); })}>Remove</button>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {error && <p className="px-5 py-2 text-sm text-red-700">{error}</p>}
      {canEdit && (
        <form key={stages.length} onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}
          className="grid items-end gap-2 border-t border-[var(--border)] px-5 py-4 sm:grid-cols-[1fr_1fr_8rem_8rem_auto]">
          <input type="hidden" name="project_id" value={projectId} />
          <div><label className="mb-1 block text-xs text-[var(--muted)]">Stage</label><input name="name" required className={input} placeholder="Deposit" /></div>
          <div><label className="mb-1 block text-xs text-[var(--muted)]">When it falls due</label><input name="due_event" className={input} placeholder="On signing" /></div>
          <div><label className="mb-1 block text-xs text-[var(--muted)]">Basis</label>
            <select name="basis" value={basis} onChange={(e) => setBasis(e.target.value as "percent" | "amount")} className={input}>
              <option value="percent">Percent</option><option value="amount">Amount</option>
            </select></div>
          <div><label className="mb-1 block text-xs text-[var(--muted)]">{basis === "percent" ? "Percent" : "Amount (MVR)"}</label>
            <input name="value" inputMode="decimal" required className={`${input} tabular-nums`} /></div>
          <button type="submit" disabled={saving} className={small}>{saving ? "Adding…" : "Add stage"}</button>
          {state?.error && <p className="text-xs text-red-700 sm:col-span-5">{state.error}</p>}
        </form>
      )}
    </Card>
  );
}
