"use client";

import { useActionState, useState, startTransition } from "react";
import { MoneyInput } from "@/components/money-input";
import { Modal } from "@/components/modal";
import { input, label, primary, small } from "@/components/form-styles";
import { directorWithdraw, financeFromCapitalPool, repayFromCapitalPool, settle, type Result } from "@/app/actions/partners";
import { money, today } from "@/lib/format";
import { dbToLaari, laariToNumber, toLaari } from "@/lib/money";

type Bank = { id: string; code: string; name: string };
// the main action of a step, as small as the others
const smallPrimary = "rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-60";
type Capital = { contact_id: string | null; name: string; available: string };

const m = (v: string | number | bigint | null | undefined) => money(laariToNumber(typeof v === "bigint" ? v : dbToLaari(v ?? 0)));
const plain = (v: string) => laariToNumber(dbToLaari(v)).toFixed(2);
const submit = (action: (fd: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd));
};

/** The action, closing its dialog once it succeeds. */
const closing = <R extends Result>(fn: (prev: unknown, fd: FormData) => Promise<R>, close: () => void) =>
  async (prev: R | null, fd: FormData): Promise<R | null> => {
    const r = await fn(prev, fd);
    if (r.ok) close();
    return r;
  };

function BankField({ id, banks, labelText = "Paid from" }: { id: string; banks: Bank[]; labelText?: string }) {
  return (
    <div><label htmlFor={id} className={label}>{labelText}</label>
      <select id={id} name="bank_id" required defaultValue="" className={input}>
        <option value="">Choose…</option>
        {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
      </select></div>
  );
}

function Choice({ value, onChange }: { value: "take" | "keep"; onChange: (v: "take" | "keep") => void }) {
  const card = (v: "take" | "keep", title: string, text: string) => (
    <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 text-sm ${value === v ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)]"}`}>
      <input type="radio" name="choice" value={v} checked={value === v} onChange={() => onChange(v)} className="mt-0.5" />
      <span><span className="block font-medium">{title}</span><span className="block text-[var(--muted)]">{text}</span></span>
    </label>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {card("take", "Take it out", "Paid to them now from a bank or cash account.")}
      {card("keep", "Keep in the company", "Goes into their director's account, ready to reinvest in a project.")}
    </div>
  );
}

/**
 * Repay a loan, or settle earnings, on one project: take it out (paid from a
 * bank or cash account) or, for a director, keep it in the company.
 */
export function SettleButton({ contactId, projectId, code, what, owed, isDirector, isAdmin, banks, start = "take", text }: {
  contactId: string; projectId: string; code: string; what: "principal" | "earnings"; owed: string;
  isDirector: boolean; isAdmin: boolean; banks: Bank[]; start?: "take" | "keep"; text: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(closing(settle, () => setOpen(false)), null as Result | null);
  const [choice, setChoice] = useState<"take" | "keep">(isDirector ? start : "take");
  const title = what === "principal" ? `Repay the loan on ${code}` : `Earnings on ${code}`;
  return (
    <>
      <button type="button" onClick={() => { setChoice(isDirector ? start : "take"); setOpen(true); }} className={start === "keep" ? small : smallPrimary}>{text}</button>
      {open && (
        <Modal title={title} size="md" onClose={() => setOpen(false)}>
          <form onSubmit={submit(action)} className="space-y-4">
            <input type="hidden" name="contact_id" value={contactId} />
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="what" value={what} />
            <p className="text-sm">{what === "principal" ? "Left to repay" : "Earned and not settled"}: <strong className="tabular-nums">{m(owed)}</strong>
              {what === "earnings" && <span className="block text-xs text-[var(--muted)]">The financing return is settled first, then the profit share.</span>}</p>
            {isDirector ? <Choice value={choice} onChange={setChoice} /> : <input type="hidden" name="choice" value="take" />}
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label htmlFor="st-amt" className={label}>Amount (MVR)</label>
                <MoneyInput id="st-amt" name="amount" required defaultValue={plain(owed)} className={`${input} tabular-nums`} /></div>
              {choice === "take" && <BankField id="st-bank" banks={banks} />}
              <div><label htmlFor="st-date" className={label}>Date</label><input id="st-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={pending} className={primary}>
                {pending ? "Saving…" : !isAdmin ? "Send for approval" : choice === "keep" ? "Keep in the company" : "Pay now"}
              </button>
              {!isAdmin && <span className="text-xs text-[var(--muted)]">An admin approves it before it happens.</span>}
              {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/**
 * Repay a loan from the Capital Pool before the client has paid (admin): how much
 * comes from each director's account and from the company's own money. The pool
 * gets it back when the client pays; it earns no share.
 */
export function PoolRepayButton({ contactId, projectId, code, owed, capital, banks }: {
  contactId: string; projectId: string; code: string; owed: string; capital: Capital[]; banks: Bank[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(closing(repayFromCapitalPool, () => setOpen(false)), null as Result | null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const rows = capital.map((c) => ({ ...c, key: c.contact_id ?? "company", avail: dbToLaari(c.available) }));
  const want = (k: string) => toLaari(amounts[k] ?? "") ?? 0n;
  const total = rows.reduce((t, r) => t + want(r.key), 0n);
  const left = dbToLaari(owed);
  const over = rows.some((r) => want(r.key) > r.avail) || total > left;
  return (
    <>
      <button type="button" onClick={() => { setAmounts({}); setOpen(true); }} className={small}>Repay from the Capital Pool</button>
      {open && (
        <Modal title={`Repay the loan on ${code} from the Capital Pool`} size="md" onClose={() => setOpen(false)}>
          <form onSubmit={submit(action)} className="space-y-4">
            <input type="hidden" name="contact_id" value={contactId} />
            <input type="hidden" name="project_id" value={projectId} />
            <p className="text-sm">The client has not paid yet. The Capital Pool repays this loan now, and gets its money back from the project when the client pays.
              It is a bridge: it earns no share of the profit.</p>
            <p className="text-sm">Left to repay: <strong className="tabular-nums">{m(owed)}</strong></p>
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--hover)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr><th className="px-3 py-2 font-medium">From</th><th className="px-3 py-2 text-right font-medium">Has</th><th className="px-3 py-2 text-right font-medium">Puts in (MVR)</th></tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] tabular-nums">
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="px-3 py-2">{r.contact_id ? `${r.name}'s director's account` : "The company's own money"}</td>
                      <td className="px-3 py-2 text-right">{m(r.avail)}</td>
                      <td className="px-3 py-2 text-right">
                        <input aria-label={`${r.contact_id ? r.name : "Company"} puts in`} name={`amt:${r.key}`} inputMode="decimal" value={amounts[r.key] ?? ""}
                          onChange={(e) => setAmounts((a) => ({ ...a, [r.key]: e.target.value }))} disabled={r.avail <= 0n}
                          className={`${input} w-36 text-right tabular-nums ${want(r.key) > r.avail ? "border-red-500" : ""}`} />
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td className="px-3 py-2">Total</td><td /><td className={`px-3 py-2 text-right ${total > left ? "text-red-700" : ""}`}>{m(total)}</td></tr>
                </tbody>
              </table>
            </div>
            {total > left && <p className="text-sm text-red-700">That is more than the {m(owed)} left to repay.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <BankField id="pr-bank" banks={banks} labelText="Lender repaid from" />
              <div><label htmlFor="pr-date" className={label}>Date</label><input id="pr-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={pending || over || total <= 0n} className={primary}>{pending ? "Saving…" : `Repay ${m(total)}`}</button>
              {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** A director's account (admin): take money out of it, or reinvest it in a project. */
export function DirectorAccountActions({ contactId, inAccount, banks, projects }: {
  contactId: string; inAccount: string; banks: Bank[]; projects: { id: string; code: string; name: string }[];
}) {
  const [open, setOpen] = useState<"out" | "in" | null>(null);
  const [outState, withdraw, withdrawing] = useActionState(closing(directorWithdraw, () => setOpen(null)), null as Result | null);
  const [inState, reinvest, reinvesting] = useActionState(closing(financeFromCapitalPool, () => setOpen(null)), null as Result | null);
  if (dbToLaari(inAccount) <= 0n) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setOpen("out")} className={small}>Take money out</button>
      <button type="button" onClick={() => setOpen("in")} className={small} disabled={projects.length === 0}>Reinvest in a project</button>
      {open === "out" && (
        <Modal title="Take money out of the director's account" size="md" onClose={() => setOpen(null)}>
          <form onSubmit={submit(withdraw)} className="space-y-4">
            <input type="hidden" name="contact_id" value={contactId} />
            <p className="text-sm">In the account: <strong className="tabular-nums">{m(inAccount)}</strong></p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label htmlFor="dw-amt" className={label}>Amount (MVR)</label><MoneyInput id="dw-amt" name="amount" required className={`${input} tabular-nums`} /></div>
              <BankField id="dw-bank" banks={banks} />
              <div><label htmlFor="dw-date" className={label}>Date</label><input id="dw-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={withdrawing} className={primary}>{withdrawing ? "Saving…" : "Pay out"}</button>
              {outState?.error && <p className="text-sm text-red-700">{outState.error}</p>}
            </div>
          </form>
        </Modal>
      )}
      {open === "in" && (
        <Modal title="Reinvest in a project" size="md" onClose={() => setOpen(null)}>
          <ReinvestForm contactId={contactId} inAccount={inAccount} projects={projects} action={reinvest} pending={reinvesting} error={inState?.error} />
        </Modal>
      )}
    </div>
  );
}

function ReinvestForm({ contactId, inAccount, projects, action, pending, error }: {
  contactId: string; inAccount: string; projects: { id: string; code: string; name: string }[];
  action: (fd: FormData) => void; pending: boolean; error?: string;
}) {
  return (
    <form onSubmit={submit(action)} className="space-y-4">
      <p className="text-sm">Money from the director&apos;s account goes into the project as their Capital Pool money. It is paid back, with its share of the profit, when the project is finished and paid for.</p>
      <p className="text-sm">In the account: <strong className="tabular-nums">{m(inAccount)}</strong></p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3"><label htmlFor="ri-project" className={label}>Project</label>
          <select id="ri-project" name="project_id" required defaultValue="" className={input}>
            <option value="">Choose…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select></div>
        <div><label htmlFor="ri-amt" className={label}>Amount (MVR)</label><MoneyInput id="ri-amt" name={`amt:${contactId}`} required className={`${input} tabular-nums`} /></div>
        <div><label htmlFor="ri-date" className={label}>Date</label><input id="ri-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Reinvest"}</button>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </form>
  );
}
