"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { input, label, primary, small } from "@/components/form-styles";
import {
  approvePayout, completeProject, deleteScheme, directorChoice, directorWithdraw, financeFromCapitalPool, recordFinancing, rejectPayout, savePayout, saveScheme, type Result,
} from "@/app/actions/partners";
import { money, today } from "@/lib/format";
import { dbToLaari, laariToNumber, toLaari } from "@/lib/money";
import { COMPONENT_LABEL } from "@/lib/partners";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { ContactForm, blankContact } from "@/components/contacts/contact-form";

type Opt = { id: string; name: string; profit_percent?: number | string | null };
type Bank = { id: string; code: string; name: string };
type Capital = { contact_id: string | null; name: string; available: string };

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
export function FinancingForm({ projectId, lenders, partners, banks, initialLender, capital }: {
  projectId: string; lenders: Opt[]; partners: Opt[]; banks: Bank[]; initialLender?: string;
  /** what the Capital Pool has available, by director's account and the company; null when this person may not use it */
  capital?: Capital[] | null;
}) {
  const [state, action, pending] = useActionState(recordFinancing, null as Result | null);
  const router = useRouter();
  // the choices are held here so a refresh after saving never clears them; the amount and reference start afresh after each save
  const start = initialLender && lenders.some((l) => l.id === initialLender) ? initialLender : "";
  // an admin starts on the Capital Pool
  const [type, setType] = useState<"capital_contribution" | "loan_receipt" | "company_capital">(start ? "loan_receipt" : capital ? "company_capital" : "loan_receipt");
  const [contact, setContact] = useState(start);
  const [bank, setBank] = useState("");
  const [currency, setCurrency] = useState("MVR");
  // loans are repaid once the project is completed and the client has paid, unless a number of days is set
  const [repay, setRepay] = useState("completion");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Opt[]>([]);   // shown until the page's list catches up
  const from = (
    <div className="px-5 pt-4 sm:w-1/3"><label htmlFor="fin-type" className={label}>From</label>
      <select id="fin-type" value={type} onChange={(e) => { setType(e.target.value as typeof type); setContact(""); }} className={input}>
        {capital && <option value="company_capital">Capital Pool (directors&apos; accounts and the company)</option>}
        <option value="loan_receipt">Lender</option>
      </select></div>
  );
  if (type === "company_capital" && capital) return <>{from}<CapitalPoolForm projectId={projectId} capital={capital} /></>;
  const who = type === "loan_receipt" ? [...lenders, ...added.filter((a) => !lenders.some((l) => l.id === a.id))].sort((a, b) => a.name.localeCompare(b.name)) : partners;
  return (
    <>
    {from}
    <form onSubmit={submit(action)} className="grid gap-3 px-5 py-4 sm:grid-cols-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="type" value={type} />
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
      <div key={`a-${state?.id ?? ""}`}><label htmlFor="fin-amt" className={label}>Amount ({currency})</label><input id="fin-amt" name="amount" inputMode="decimal" required className={`${input} tabular-nums`} /></div>
      <div><label htmlFor="fin-cur" className={label}>Currency</label>
        <div className="flex gap-2">
          <select id="fin-cur" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={input}><option>MVR</option><option>USD</option></select>
          {currency !== "MVR" && <input name="fx_rate" aria-label="MVR per unit" required placeholder="15.42" inputMode="decimal" className={`${input} w-28 tabular-nums`} />}
        </div></div>
      <div key={`r-${state?.id ?? ""}`}><label htmlFor="fin-ref" className={label}>Reference</label><input id="fin-ref" name="reference" className={input} /></div>
      <div key={`p-${contact}`}><label htmlFor="fin-pct" className={label}>Profit share (%)</label>
        <div className="relative">
          <input id="fin-pct" name="profit_percent" inputMode="decimal" placeholder="20" defaultValue={who.find((c) => c.id === contact)?.profit_percent ?? ""} className={`${input} pr-8 tabular-nums`} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[var(--muted)]">%</span>
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">Their share of the profit, split by how much each put in. Blank is 20%.</p></div>
      <div><label htmlFor="fin-repay" className={label}>Repaid</label>
        <select id="fin-repay" value={repay} onChange={(e) => setRepay(e.target.value)} className={input}>
          <option value="completion">When the project is completed and the client has paid</option>
          <option value="days">Within a number of days</option>
        </select>
        {repay === "days" && (
          <input aria-label="Repay within (days)" name="terms_days" inputMode="numeric" required placeholder="Days, e.g. 180" className={`${input} mt-2 tabular-nums`} />
        )}</div>
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

/**
 * Finance the project from the Capital Pool: how much comes from each director's
 * account and from the company's own money, each typed in; none can be more than
 * it has.
 */
function CapitalPoolForm({ projectId, capital }: { projectId: string; capital: Capital[] }) {
  const [state, action, pending] = useActionState(financeFromCapitalPool, null as (Result & { parts?: { name: string; amount: number }[] }) | null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const rows = capital.map((c) => ({ ...c, key: c.contact_id ?? "company", avail: dbToLaari(c.available) }));
  const want = (k: string) => toLaari(amounts[k] ?? "") ?? 0n;
  const total = rows.reduce((t, r) => t + want(r.key), 0n);
  const over = rows.some((r) => want(r.key) > r.avail);
  return (
    <form key={state?.ok ? JSON.stringify(state.parts) : "form"} onSubmit={submit(action)} className="space-y-4 px-5 py-4">
      <input type="hidden" name="project_id" value={projectId} />
      <p className="text-sm">From the <strong>Capital Pool</strong>: type how much comes from each director&apos;s account and from the company&apos;s own money. Each becomes their Capital Pool money in this project and earns its part of the financing pool&apos;s share.</p>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--hover)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr><th className="px-3 py-2 font-medium">Whose</th><th className="px-3 py-2 text-right font-medium">Available</th><th className="px-3 py-2 text-right font-medium">Puts in (MVR)</th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] tabular-nums">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2">{r.contact_id ? `${r.name}'s director's account` : "Company"}
                  {!r.contact_id && <span className="block text-xs text-[var(--muted)]">its own money: bank and cash less everything it owes (directors, lenders, GST, vendors, salaries); a project&apos;s money stays in the project until it is completed and paid</span>}</td>
                <td className="px-3 py-2 text-right">{money(laariToNumber(r.avail))}</td>
                <td className="px-3 py-2 text-right">
                  <input aria-label={`${r.contact_id ? r.name : "Company"} puts in`} name={`amt:${r.key}`} inputMode="decimal" value={amounts[r.key] ?? ""}
                    onChange={(e) => setAmounts((a) => ({ ...a, [r.key]: e.target.value }))} disabled={r.avail <= 0n}
                    className={`${input} w-36 text-right tabular-nums ${want(r.key) > r.avail ? "border-red-500" : ""}`} />
                  {want(r.key) > r.avail && <span className="block text-xs text-red-700">More than {money(laariToNumber(r.avail))}</span>}
                </td>
              </tr>
            ))}
            <tr className="font-semibold"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{money(laariToNumber(rows.reduce((t, r) => t + r.avail, 0n)))}</td>
              <td className="px-3 py-2 text-right">{money(laariToNumber(total))}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label htmlFor="cc-date" className={label}>Date</label><input id="cc-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || over || total <= 0n} className={primary}>{pending ? "Saving…" : "Finance from the Capital Pool"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && <p className="text-sm text-[var(--muted)]">Recorded: {(state.parts ?? []).map((x) => `${x.name} ${money(x.amount)}`).join(" · ")}</p>}
      </div>
    </form>
  );
}

/**
 * A director's choices (admin): for money waiting for them, keep it in the company
 * (it goes into their director's account) or take it out now; and pay them out of
 * their director's account.
 */
export function DirectorAccountForms({ contactId, name, waiting, inAccount, banks }: {
  contactId: string; name: string; waiting: string; inAccount: string; banks: Bank[];
}) {
  const [choiceState, choose, choosing] = useActionState(directorChoice, null as Result | null);
  const [outState, withdraw, withdrawing] = useActionState(directorWithdraw, null as Result | null);
  const [choice, setChoice] = useState<"keep" | "take">("keep");
  const hasWaiting = dbToLaari(waiting) > 0n, hasAccount = dbToLaari(inAccount) > 0n;
  return (
    <div className="divide-y divide-[var(--border)]">
      {hasWaiting && (
        <form key={`c-${waiting}`} onSubmit={submit(choose)} className="space-y-3 px-5 py-4">
          <input type="hidden" name="contact_id" value={contactId} />
          <p className="text-sm font-medium">{m(waiting)} is waiting for {name}&apos;s choice</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="choice" value="keep" checked={choice === "keep"} onChange={() => setChoice("keep")} /> Keep in the company (into the director&apos;s account)</label>
            <label className="flex items-center gap-2"><input type="radio" name="choice" value="take" checked={choice === "take"} onChange={() => setChoice("take")} /> Take out now</label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label htmlFor="dc-amt" className={label}>Amount (MVR)</label><input id="dc-amt" name="amount" inputMode="decimal" required defaultValue={laariToNumber(dbToLaari(waiting)).toFixed(2)} className={`${input} tabular-nums`} /></div>
            {choice === "take" && <div><label htmlFor="dc-bank" className={label}>Paid from</label><BankSelect id="dc-bank" banks={banks} /></div>}
            <div><label htmlFor="dc-date" className={label}>Date</label><input id="dc-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={choosing} className={primary}>{choosing ? "Saving…" : choice === "keep" ? "Keep in the company" : "Pay out"}</button>
            {choiceState?.error && <p className="text-sm text-red-700">{choiceState.error}</p>}
            {choiceState?.ok && <p className="text-sm text-[var(--muted)]">Recorded.</p>}
          </div>
        </form>
      )}
      {hasAccount && (
        <form key={`w-${inAccount}`} onSubmit={submit(withdraw)} className="space-y-3 px-5 py-4">
          <input type="hidden" name="contact_id" value={contactId} />
          <p className="text-sm font-medium">Pay out of the director&apos;s account <span className="font-normal text-[var(--muted)]">· {m(inAccount)} in it</span></p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label htmlFor="dw-amt" className={label}>Amount (MVR)</label><input id="dw-amt" name="amount" inputMode="decimal" required className={`${input} tabular-nums`} /></div>
            <div><label htmlFor="dw-bank" className={label}>Paid from</label><BankSelect id="dw-bank" banks={banks} /></div>
            <div><label htmlFor="dw-date" className={label}>Date</label><input id="dw-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={withdrawing} className={primary}>{withdrawing ? "Saving…" : "Pay out"}</button>
            {outState?.error && <p className="text-sm text-red-700">{outState.error}</p>}
            {outState?.ok && <p className="text-sm text-[var(--muted)]">Paid.</p>}
          </div>
        </form>
      )}
    </div>
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
