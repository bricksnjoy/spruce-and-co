"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { input, label, primary, small } from "@/components/form-styles";
import {
  approvePayout, completeProject, deleteScheme, recordFinancing, rejectPayout, savePayout, saveScheme, type Result,
} from "@/app/actions/partners";
import { money, today } from "@/lib/format";
import { dbToLaari, laariToNumber, toLaari } from "@/lib/money";
import { COMPONENT_LABEL } from "@/lib/partners";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { ContactForm, blankContact } from "@/components/contacts/contact-form";

type Opt = { id: string; name: string };
type Bank = { id: string; code: string; name: string };

const submit = (action: (fd: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd));
};
const m = (v: string | number | null | undefined) => money(laariToNumber(dbToLaari(v)));

function BankSelect({ id, banks }: { id: string; banks: Bank[] }) {
  return (
    <select id={id} name="bank_id" required defaultValue="" className={input}>
      <option value="">Choose…</option>
      {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
    </select>
  );
}

/** Money received for a project: an external loan or a Capital Pool contribution. A new lender can be added here. */
export function FinancingForm({ projectId, lenders, partners, banks, initialLender }: {
  projectId: string; lenders: Opt[]; partners: Opt[]; banks: Bank[]; initialLender?: string;
}) {
  const [state, action, pending] = useActionState(recordFinancing, null as Result | null);
  const router = useRouter();
  // the choices are held here so a refresh after saving never clears them; the amount and reference start afresh after each save
  const start = initialLender && lenders.some((l) => l.id === initialLender) ? initialLender : "";
  const [type, setType] = useState<"capital_contribution" | "loan_receipt">(start ? "loan_receipt" : "capital_contribution");
  const [contact, setContact] = useState(start);
  const [bank, setBank] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Opt[]>([]);   // shown until the page's list catches up
  const who = type === "loan_receipt" ? [...lenders, ...added.filter((a) => !lenders.some((l) => l.id === a.id))].sort((a, b) => a.name.localeCompare(b.name)) : partners;
  return (
    <>
    <form onSubmit={submit(action)} className="grid gap-3 px-5 py-4 sm:grid-cols-3">
      <input type="hidden" name="project_id" value={projectId} />
      <div><label htmlFor="fin-type" className={label}>From</label>
        <select id="fin-type" name="type" value={type} onChange={(e) => { setType(e.target.value as typeof type); setContact(""); }} className={input}>
          <option value="capital_contribution">Capital Pool member</option>
          <option value="loan_receipt">External lender</option>
        </select></div>
      <div><label htmlFor="fin-who" className={label}>{type === "loan_receipt" ? "Lender" : "Member"}</label>
        <select id="fin-who" name="contact_id" required value={contact} onChange={(e) => setContact(e.target.value)} className={input}>
          <option value="">Choose…</option>
          {who.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {type === "loan_receipt"
          ? <button type="button" onClick={() => setAdding(true)} className="mt-1 text-xs font-medium text-[var(--brand)] hover:underline">+ New lender</button>
          : who.length === 0 && <p className="mt-1 text-xs text-[var(--muted)]">No Capital Pool members yet.</p>}</div>
      <div><label htmlFor="fin-bank" className={label}>Paid into</label>
        <select id="fin-bank" name="bank_id" required value={bank} onChange={(e) => setBank(e.target.value)} className={input}>
          <option value="">Choose…</option>
          {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
        </select></div>
      <div><label htmlFor="fin-date" className={label}>Date received</label><input id="fin-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
      <div key={`a-${state?.id ?? ""}`}><label htmlFor="fin-amt" className={label}>Amount (MVR)</label><input id="fin-amt" name="amount" inputMode="decimal" required className={`${input} tabular-nums`} /></div>
      <div key={`r-${state?.id ?? ""}`}><label htmlFor="fin-ref" className={label}>Reference</label><input id="fin-ref" name="reference" className={input} /></div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Record financing"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && <p className="text-sm text-[var(--muted)]">Recorded.</p>}
      </div>
    </form>
      {adding && (
        <Modal title="New lender" size="md" onClose={() => setAdding(false)}>
          <ContactForm contact={blankContact("lender")} base="/partners/lenders" onDone={() => setAdding(false)}
            onCreated={(id, name) => { setAdded((a) => [...a, { id, name }]); setContact(id); setAdding(false); router.refresh(); }} />
        </Modal>
      )}
    </>
  );
}

/** Confirm the split preview and complete the project. */
export function CompleteForm({ projectId, profit }: { projectId: string; profit: string }) {
  const [state, action, pending] = useActionState(completeProject, null as Result | null);
  return (
    <form onSubmit={submit(action)} className="space-y-3 px-5 py-4">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="max-w-xs"><label htmlFor="cp-date" className={label}>Completion date</label>
        <input id="cp-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-0.5" />
        <span>Complete the project on a profit of <strong className="tabular-nums">{profit}</strong> and post the split above.
          Anything posted to the project later adjusts the split with a separate entry.</span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Posting…" : "Complete and post split"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </div>
    </form>
  );
}

export type OwedRow = { project_id: string; code: string; component: string; outstanding: string; blocked: boolean; reason: string | null };

/** Pay one person what is owed, line by line; blocked projects cannot be paid. */
export function PayoutForm({ contactId, banks, rows, isAdmin }: { contactId: string; banks: Bank[]; rows: OwedRow[]; isAdmin: boolean }) {
  const [state, action, pending] = useActionState(savePayout, null as Result | null);
  const [amts, setAmts] = useState<Record<string, string>>({});
  const total = Object.values(amts).reduce((s, v) => s + (toLaari(v) ?? 0n), 0n);
  return (
    <form key={state?.id ?? "p"} onSubmit={submit(action)} className="space-y-4 px-5 py-4">
      <input type="hidden" name="contact_id" value={contactId} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-[var(--muted)]"><th className="py-1.5 pr-3 font-medium">Project</th><th className="pr-3 font-medium">Component</th>
            <th className="pr-3 text-right font-medium">Owed</th><th className="text-right font-medium">Pay now</th></tr></thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((r) => {
              const k = `amt:${r.project_id}:${r.component}`;
              return (
                <tr key={k}>
                  <td className="py-2 pr-3 font-mono text-xs">{r.code}</td>
                  <td className="pr-3">{COMPONENT_LABEL[r.component] ?? r.component}</td>
                  <td className="pr-3 text-right tabular-nums">{m(r.outstanding)}</td>
                  <td className="text-right">
                    {r.blocked ? <span className="text-xs text-red-700">{r.reason}</span> : (
                      <span className="inline-flex items-center gap-2">
                        <button type="button" className="text-xs text-[var(--brand)] hover:underline" onClick={() => setAmts((a) => ({ ...a, [k]: String(r.outstanding) }))}>All</button>
                        <input name={k} aria-label={`Pay ${COMPONENT_LABEL[r.component]} on ${r.code}`} inputMode="decimal" value={amts[k] ?? ""}
                          onChange={(e) => setAmts((a) => ({ ...a, [k]: e.target.value }))} className={`${input} w-32 py-1 text-right tabular-nums`} />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label htmlFor="po-bank" className={label}>Paid from</label><BankSelect id="po-bank" banks={banks} /></div>
        <div><label htmlFor="po-date" className={label}>Date</label><input id="po-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
        <div><label htmlFor="po-ref" className={label}>Reference</label><input id="po-ref" name="reference" className={input} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || total <= 0n} className={primary}>
          {pending ? "Saving…" : isAdmin ? `Approve and pay ${money(laariToNumber(total))}` : `Send ${money(laariToNumber(total))} for approval`}
        </button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && <p className="text-sm text-[var(--muted)]">{isAdmin ? "Paid." : "Sent to an admin for approval."}</p>}
      </div>
    </form>
  );
}

/** Approve (admin) or turn down a payout awaiting approval. */
export function PayoutApproval({ id, isAdmin }: { id: string; isAdmin: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const run = (fn: () => Promise<Result>) => start(async () => { const r = await fn(); setError(r.error ?? null); });
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {isAdmin && !rejecting && <button type="button" disabled={pending} onClick={() => run(() => approvePayout(id))} className={small}>Approve and pay</button>}
      {rejecting ? (
        <>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why not?" aria-label="Reason" className={`${input} w-40 py-1`} />
          <button type="button" disabled={pending} onClick={() => run(() => rejectPayout(id, reason))} className={`${small} border-red-300 text-red-700`}>Turn down</button>
          <button type="button" onClick={() => setRejecting(false)} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
        </>
      ) : <button type="button" onClick={() => setRejecting(true)} className="text-xs font-medium text-red-700 hover:underline">{isAdmin ? "Turn down…" : "Withdraw…"}</button>}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

/** A new scheme version: the pool, the company and each partner's share, totalling 100%. */
export function SchemeForm({ partners, current }: { partners: Opt[]; current: Record<string, string> }) {
  const [state, action, pending] = useActionState(saveScheme, null as Result | null);
  const [pcts, setPcts] = useState<Record<string, string>>(current);
  const total = Object.values(pcts).reduce((s, v) => s + (Number(v) || 0), 0);
  const field = (key: string, name: string) => (
    <div key={key} className="flex items-center justify-between gap-3">
      <label htmlFor={`pct-${key}`} className="text-sm">{name}</label>
      <input id={`pct-${key}`} name={`pct:${key}`} inputMode="decimal" value={pcts[key] ?? ""} onChange={(e) => setPcts((p) => ({ ...p, [key]: e.target.value }))}
        className={`${input} w-24 py-1 text-right tabular-nums`} />
    </div>
  );
  return (
    <form key={state?.id ?? "s"} onSubmit={submit(action)} className="space-y-4 px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="sc-name" className={label}>Name</label><input id="sc-name" name="name" required className={input} /></div>
        <div><label htmlFor="sc-from" className={label}>Applies to projects starting on or after</label><input id="sc-from" name="effective_from" type="date" required className={input} /></div>
      </div>
      <div className="max-w-sm space-y-2">
        {field("pool", "Investors (financing pool)")}
        {field("company", "Company (retained)")}
        {partners.map((p) => field(p.id, p.name))}
        <p className={`flex justify-between border-t border-[var(--border)] pt-2 text-sm font-semibold ${Math.abs(total - 100) > 1e-9 ? "text-red-700" : ""}`}>
          <span>Total</span><span className="tabular-nums">{Number(total.toFixed(4))}%</span></p>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Add scheme version"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && <p className="text-sm text-[var(--muted)]">Added.</p>}
      </div>
    </form>
  );
}

export function DeleteScheme({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} className="text-xs font-medium text-red-700 hover:underline"
        onClick={() => { if (confirm("Remove this scheme version? Its projects go back to the version before.")) start(async () => { const r = await deleteScheme(id); setError(r.error ?? null); }); }}>
        Remove
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
