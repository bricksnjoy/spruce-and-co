"use client";

import { useActionState, useState } from "react";
import { money, date, today } from "@/lib/format";
import {
  markCompleted,
  unmarkCompleted,
  markPaymentReceived,
  unmarkPaymentReceived,
  type StatusResult,
} from "@/app/actions/project-status";

const input =
  "rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";

/**
 * Finishing the work and being paid for it are separate events, often months
 * apart, so they are separate controls rather than one "done".
 */
export function StatusBar({
  projectId,
  completedAt,
  paymentReceivedAt,
  paymentAmount,
  expected,
}: {
  projectId: string;
  completedAt: string | null;
  paymentReceivedAt: string | null;
  paymentAmount: number | null;
  /** value plus variations — what the client is expected to pay */
  expected: number;
}) {
  const [completeState, completeAction, completing] = useActionState(
    markCompleted,
    null as StatusResult | null,
  );
  const [undoCompleteState, undoCompleteAction] = useActionState(
    unmarkCompleted,
    null as StatusResult | null,
  );
  const [payState, payAction, paying] = useActionState(
    markPaymentReceived,
    null as StatusResult | null,
  );
  const [undoPayState, undoPayAction] = useActionState(
    unmarkPaymentReceived,
    null as StatusResult | null,
  );

  const [askCompleted, setAskCompleted] = useState(false);
  const [askPaid, setAskPaid] = useState(false);
  const todayIso = today();

  const error =
    completeState?.error ?? undoCompleteState?.error ?? payState?.error ?? undoPayState?.error;

  return (
    <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        {/* work finished */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            Work
          </p>
          {completedAt ? (
            <div className="mt-1 flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <Tick /> Completed {date(completedAt)}
              </span>
              <form action={undoCompleteAction}>
                <input type="hidden" name="project_id" value={projectId} />
                <button type="submit"
                  className="text-xs text-[var(--muted)] hover:text-red-700 hover:underline">
                  Undo
                </button>
              </form>
            </div>
          ) : askCompleted ? (
            <form action={completeAction} className="mt-1 flex items-center gap-2">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="date" name="date" defaultValue={todayIso} className={input} />
              <button type="submit" disabled={completing}
                className="rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-60">
                {completing ? "Saving…" : "Confirm completed"}
              </button>
              <button type="button" onClick={() => setAskCompleted(false)}
                className="text-xs text-[var(--muted)] hover:underline">
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setAskCompleted(true)}
              className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--field)] px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)]">
              Mark completed
            </button>
          )}
        </div>

        {/* money in */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            Payment
          </p>
          {paymentReceivedAt ? (
            <div className="mt-1 flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <Tick /> Received {date(paymentReceivedAt)}
                {paymentAmount ? ` · ${money(paymentAmount)}` : ""}
              </span>
              <form action={undoPayAction}>
                <input type="hidden" name="project_id" value={projectId} />
                <button type="submit"
                  className="text-xs text-[var(--muted)] hover:text-red-700 hover:underline">
                  Undo
                </button>
              </form>
            </div>
          ) : askPaid ? (
            <form action={payAction} className="mt-1 flex flex-wrap items-center gap-2">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="date" name="date" defaultValue={todayIso} className={input} />
              <input type="number" step="0.01" name="amount" defaultValue={expected || ""}
                placeholder="Amount" className={`${input} w-36`} />
              <button type="submit" disabled={paying}
                className="rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-60">
                {paying ? "Saving…" : "Confirm received"}
              </button>
              <button type="button" onClick={() => setAskPaid(false)}
                className="text-xs text-[var(--muted)] hover:underline">
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setAskPaid(true)}
              disabled={!completedAt}
              title={completedAt ? undefined : "Mark the work completed first"}
              className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--field)] px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] disabled:opacity-40">
              Mark payment received
            </button>
          )}
        </div>

        {completedAt && !paymentReceivedAt && (
          <p className="text-xs text-amber-800">
            Profit accrued to the internal account and awaiting payment.
          </p>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="2" aria-hidden="true">
      <path d="M3 8.5l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
