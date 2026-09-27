"use client";

import { useActionState, useEffect, useState } from "react";
import { date, money, today } from "@/lib/format";
import {
  recordRepayment,
  deleteRepayment,
  markInvestorPaid,
  unmarkInvestorPaid,
  type RepaymentResult,
} from "@/app/actions/repayments";

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-sm font-medium";

export interface RepayTarget {
  investorId: string;
  investorName: string;
  projectId: string;
  projectName: string;
  capitalOwed: number;
  profitOwed: number;
  /** whether the client has paid — capital comes back out of that payment's cost */
  clientPaid?: boolean;
}

export function RepayButton({ target }: { target: RepayTarget }) {
  const [open, setOpen] = useState(false);
  const owed = target.capitalOwed + target.profitOwed;
  if (owed <= 0.005) return <span className="text-xs text-emerald-700">Paid back</span>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-2.5 py-1 text-xs font-medium transition-colors hover:bg-[var(--hover)]">
        Repay
      </button>
      {open && <RepayModal target={target} onClose={() => setOpen(false)} />}
    </>
  );
}

function RepayModal({ target, onClose }: { target: RepayTarget; onClose: () => void }) {
  const [state, action, pending] = useActionState(recordRepayment, null as RepaymentResult | null);
  const [capital, setCapital] = useState(target.capitalOwed > 0 ? target.capitalOwed.toFixed(2) : "");
  const [profit, setProfit] = useState(target.profitOwed > 0 ? target.profitOwed.toFixed(2) : "");
  const paying = (Number(capital) || 0) + (Number(profit) || 0);
  const left = target.capitalOwed + target.profitOwed - paying;

  useEffect(() => {
    if (state?.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Repay investor"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 text-left sm:p-8"
      onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--field)] shadow-[0_24px_60px_-20px_rgba(13,27,42,0.4)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Repay {target.investorName}</h2>
            <p className="text-xs text-[var(--muted)]">{target.projectName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-[var(--muted)] transition-colors hover:text-[var(--text)]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form action={action} className="space-y-4 px-5 py-5">
          <input type="hidden" name="investor_id" value={target.investorId} />
          <input type="hidden" name="project_id" value={target.projectId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="r-capital" className={label}>Capital returned</label>
              <p className="-mt-1 mb-1.5 text-[11px] text-[var(--muted)]">from the project cost</p>
              <input id="r-capital" name="capital" type="number" step="0.01" min="0"
                max={target.capitalOwed} value={capital} onChange={(e) => setCapital(e.target.value)}
                className={input} />
              <p className="mt-1 text-xs text-[var(--muted)]">owed {money(target.capitalOwed)}</p>
            </div>
            <div>
              <label htmlFor="r-profit" className={label}>Profit paid</label>
              <p className="-mt-1 mb-1.5 text-[11px] text-[var(--muted)]">from their profit share</p>
              <input id="r-profit" name="profit" type="number" step="0.01" min="0"
                max={target.profitOwed} value={profit} onChange={(e) => setProfit(e.target.value)}
                className={input} disabled={target.profitOwed <= 0} />
              <p className="mt-1 text-xs text-[var(--muted)]">
                {target.profitOwed > 0 ? `owed ${money(target.profitOwed)}` : "due once the project is completed"}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="r-date" className={label}>Paid on</label>
              <input id="r-date" name="paid_on" type="date"
                defaultValue={today()} className={input} />
            </div>
            <div>
              <label htmlFor="r-note" className={label}>Note</label>
              <input id="r-note" name="note" className={input} placeholder="Bank transfer" />
            </div>
          </div>

          <p className="text-xs text-[var(--muted)]">
            Their capital paid for the work, so it is returned out of the cost part of the
            client&apos;s payment — it does not reduce the project&apos;s profit.
            {target.clientPaid === false && Number(capital) > 0 && (
              <span className="mt-1 block text-amber-800">
                The client has not paid for this project yet, so this capital is being returned
                before the cost has come back.
              </span>
            )}
          </p>

          <p className="rounded-lg bg-[var(--hover)] px-3 py-2 text-sm">
            Paying <span className="font-medium">{money(paying)}</span>
            {" · "}
            {left > 0.005 ? (
              <>still owed afterwards <span className="font-medium text-amber-700">{money(left)}</span></>
            ) : (
              <span className="font-medium text-emerald-700">fully paid back</span>
            )}
          </p>

          {state?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending || paying <= 0}
              className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50">
              {pending ? "Saving…" : "Record repayment"}
            </button>
            <button type="button" onClick={onClose} className="text-sm text-[var(--muted)] hover:underline">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function UndoRepayment({ id }: { id: string }) {
  return (
    <button type="button" onClick={() => deleteRepayment(id)}
      className="text-xs text-[var(--muted)] hover:text-red-700">
      Undo
    </button>
  );
}

/**
 * Whether an investor has been paid on a project. One press ticks them off;
 * pressing "Paid" again (and confirming) takes the tick back off.
 */
export function PaidToggle({
  projectId,
  investorId,
  paidAt,
}: {
  projectId: string;
  investorId: string;
  paidAt: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (paidAt && !confirm("Mark this investor as not paid again?")) return;
    setPending(true);
    setError(null);
    const r = paidAt
      ? await unmarkInvestorPaid(projectId, investorId)
      : await markInvestorPaid(projectId, investorId);
    setPending(false);
    if (r.error) setError(r.error);
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button type="button" onClick={toggle} disabled={pending}
        title={paidAt ? `Marked paid ${date(paidAt)} — press to undo` : undefined}
        className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
          paidAt
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "border border-[var(--border)] bg-[var(--field)] hover:bg-[var(--hover)]"
        }`}>
        {pending ? "Saving…" : paidAt ? "✓ Paid" : "Mark paid"}
      </button>
    </span>
  );
}
