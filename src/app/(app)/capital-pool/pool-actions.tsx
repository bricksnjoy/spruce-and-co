"use client";

import { useActionState, useEffect, useState } from "react";
import { money, today } from "@/lib/format";
import {
  recordContributions,
  recordWithdrawal,
  deletePoolEntry,
  type PoolResult,
} from "@/app/actions/capital-pool";

interface Member {
  id: string;
  name: string;
  balance: number;
}

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-sm font-medium";

export function PoolActions({ members, available }: { members: Member[]; available: number }) {
  const [mode, setMode] = useState<null | "in" | "out">(null);

  return (
    <>
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode("out")}
          className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)]">
          Withdraw
        </button>
        <button type="button" onClick={() => setMode("in")}
          className="rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)]">
          + Add money to pool
        </button>
      </div>

      {mode === "in" && <ContributionModal members={members} onClose={() => setMode(null)} />}
      {mode === "out" && (
        <WithdrawalModal members={members} available={available} onClose={() => setMode(null)} />
      )}
    </>
  );
}

function Shell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--field)] shadow-[0_24px_60px_-20px_rgba(13,27,42,0.4)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="text-xs text-[var(--muted)]">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-[var(--muted)] transition-colors hover:text-[var(--text)]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ContributionModal({ members, onClose }: { members: Member[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(recordContributions, null as PoolResult | null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (state?.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const total = Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0);

  return (
    <Shell title="Add money to the pool"
      subtitle="One member or several at once — an opening balance goes in as one entry"
      onClose={onClose}>
      <form action={action} className="space-y-4 px-5 py-5">
        <input type="hidden" name="count" value={members.length} />
        <div className="space-y-2">
          {members.map((m, i) => {
            const v = Number(amounts[m.id]) || 0;
            return (
              <div key={m.id} className="flex items-center gap-3">
                <input type="hidden" name={`member_${i}`} value={m.id} />
                <span className="w-36 shrink-0 text-sm font-medium">{m.name}</span>
                <input name={`amount_${i}`} type="number" step="0.01" min="0"
                  value={amounts[m.id] ?? ""}
                  onChange={(e) => setAmounts((a) => ({ ...a, [m.id]: e.target.value }))}
                  className={input} placeholder="0.00" />
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
                  {total > 0 && v > 0 ? `${((v / total) * 100).toFixed(1)}%` : ""}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-right text-sm">
          <span className="text-[var(--muted)]">Adding</span>{" "}
          <span className="font-semibold tabular-nums">{money(total)}</span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="c-date" className={label}>Date</label>
            <input id="c-date" name="entry_date" type="date"
              defaultValue={today()} className={input} />
          </div>
          <div>
            <label htmlFor="c-note" className={label}>Note</label>
            <input id="c-note" name="note" className={input} placeholder="Opening balance" />
          </div>
        </div>
        {state?.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending || total <= 0}
            className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50">
            {pending ? "Saving…" : "Add to pool"}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-[var(--muted)] hover:underline">
            Cancel
          </button>
        </div>
      </form>
    </Shell>
  );
}

function WithdrawalModal({
  members,
  available,
  onClose,
}: {
  members: Member[];
  available: number;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(recordWithdrawal, null as PoolResult | null);
  const [memberId, setMemberId] = useState(members.find((m) => m.balance > 0)?.id ?? "");
  const member = members.find((m) => m.id === memberId);

  useEffect(() => {
    if (state?.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Shell title="Withdraw from the pool"
      subtitle={`${money(available)} is free — the rest is reinvested in unpaid projects`}
      onClose={onClose}>
      <form action={action} className="space-y-4 px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="w-member" className={label}>Member</label>
            <select id="w-member" name="member_id" value={memberId}
              onChange={(e) => setMemberId(e.target.value)} className={input}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            {member && (
              <p className="mt-1 text-xs text-[var(--muted)]">Holds {money(member.balance)}</p>
            )}
          </div>
          <div>
            <label htmlFor="w-amount" className={label}>Amount</label>
            <input id="w-amount" name="amount" type="number" step="0.01" min="0" required className={input} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="w-date" className={label}>Date</label>
            <input id="w-date" name="entry_date" type="date"
              defaultValue={today()} className={input} />
          </div>
          <div>
            <label htmlFor="w-note" className={label}>Note</label>
            <input id="w-note" name="note" className={input} placeholder="To personal account" />
          </div>
        </div>
        {state?.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending}
            className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50">
            {pending ? "Saving…" : "Withdraw"}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-[var(--muted)] hover:underline">
            Cancel
          </button>
        </div>
      </form>
    </Shell>
  );
}

export function RemoveEntry({ id }: { id: string }) {
  return (
    <button type="button" onClick={() => deletePoolEntry(id)}
      className="text-xs text-[var(--muted)] hover:text-red-700">
      Remove
    </button>
  );
}
