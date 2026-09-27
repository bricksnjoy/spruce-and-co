"use client";

import { useActionState, useEffect, useState } from "react";
import { money } from "@/lib/format";
import { monthsCovered } from "@/lib/salaries";
import {
  createSalaryPlan,
  paySalary,
  payAllDue,
  undoSalaryPayment,
  stopSalaryPlan,
  type SalaryResult,
} from "@/app/actions/salaries";

export interface PersonOption {
  id: string;
  name: string;
  role: string;
  pool_member_id: string | null;
}

export interface MemberOption {
  id: string;
  name: string;
  kind: string;
  balance: number;
  /** what they can take: their balance less what is invested in projects */
  free: number;
  invested: number;
}

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-sm font-medium";

export function NewPlanButton({
  people,
  members,
  month,
}: {
  people: PersonOption[];
  members: MemberOption[];
  month: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)]">
        + New salary
      </button>
      {open && <PlanModal people={people} members={members} month={month} onClose={() => setOpen(false)} />}
    </>
  );
}

function PlanModal({
  people,
  members,
  month,
  onClose,
}: {
  people: PersonOption[];
  members: MemberOption[];
  month: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(createSalaryPlan, null as SalaryResult | null);
  const company = members.find((m) => m.kind === "company");
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const person = people.find((p) => p.id === personId);
  const isEmployee = person?.role === "employee";

  // their own share by default; employees are always paid from company money
  const defaultMember = isEmployee ? company?.id : person?.pool_member_id ?? company?.id;
  // a choice made for this person; otherwise their default
  const [picked, setPicked] = useState<{ person: string; member: string } | null>(null);
  const memberId = picked?.person === personId ? picked.member : (defaultMember ?? "");
  const setMemberId = (member: string) => setPicked({ person: personId, member });

  const [monthly, setMonthly] = useState("");
  const [term, setTerm] = useState<"until_empty" | "fixed">("until_empty");
  const [months, setMonths] = useState("3");

  const member = members.find((m) => m.id === memberId);
  const amount = Number(monthly) || 0;
  const covered = member ? monthsCovered(member.free, amount) : 0;
  const fixedTotal = amount * (Number(months) || 0);
  const tooMuch = term === "fixed" && member ? fixedTotal > member.free + 0.001 : false;

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
    <div role="dialog" aria-modal="true" aria-label="New salary"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--field)] shadow-[0_24px_60px_-20px_rgba(13,27,42,0.4)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">New salary</h2>
            <p className="text-xs text-[var(--muted)]">
              Paid monthly from a share of the capital pool — never more than that share holds
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-[var(--muted)] transition-colors hover:text-[var(--text)]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form action={action} className="space-y-4 px-5 py-5">
          <input type="hidden" name="paid_from_member_id" value={memberId} />
          <input type="hidden" name="term" value={term} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="s-person" className={label}>Who</label>
              <select id="s-person" name="person_id" value={personId}
                onChange={(e) => setPersonId(e.target.value)} className={input}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="s-amount" className={label}>Per month</label>
              <input id="s-amount" name="monthly_amount" type="number" step="0.01" min="0" required
                value={monthly} onChange={(e) => setMonthly(e.target.value)}
                className={input} placeholder="25000" />
            </div>
          </div>

          <div>
            <label htmlFor="s-from" className={label}>Paid from</label>
            {isEmployee ? (
              <p className="rounded-lg bg-[var(--hover)] px-3 py-2 text-sm">
                {company?.name ?? "Company"} — employees are paid from company money
              </p>
            ) : (
              <select id="s-from" value={memberId} onChange={(e) => setMemberId(e.target.value)}
                className={input}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}&apos;s share · {money(m.free)} free
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="s-start" className={label}>Starting</label>
              <input id="s-start" name="start_month" type="month" defaultValue={month.slice(0, 7)}
                className={input} />
            </div>
            <div>
              <label className={label}>For</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTerm("until_empty")}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium ${
                    term === "until_empty"
                      ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                      : "border-[var(--border)] hover:bg-[var(--hover)]"
                  }`}>
                  Until share runs out
                </button>
                <button type="button" onClick={() => setTerm("fixed")}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium ${
                    term === "fixed"
                      ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                      : "border-[var(--border)] hover:bg-[var(--hover)]"
                  }`}>
                  Set months
                </button>
              </div>
            </div>
          </div>

          {term === "fixed" && (
            <div className="w-40">
              <label htmlFor="s-months" className={label}>Months</label>
              <input id="s-months" name="months" type="number" min="1" value={months}
                onChange={(e) => setMonths(e.target.value)} className={input} />
            </div>
          )}

          {member && amount > 0 && (
            <p className={`rounded-lg px-3 py-2 text-sm ${
              tooMuch ? "bg-red-50 text-red-700" : "bg-[var(--hover)]"
            }`}>
              {member.name} has <span className="font-medium">{money(member.free)}</span> free
              {member.invested > 0 && (
                <> ({money(member.invested)} more is invested in projects and locked until they are paid)</>
              )}
              .{" "}
              {tooMuch
                ? `${months} months at ${money(amount)} is ${money(fixedTotal)} — more than that. ${covered} month${covered === 1 ? "" : "s"} is the most it covers.`
                : term === "fixed"
                  ? `${months} months at ${money(amount)} takes ${money(fixedTotal)}.`
                  : `At ${money(amount)} a month that lasts ${covered} month${covered === 1 ? "" : "s"}${
                      covered && member.free % amount ? `, the last one ${money(member.free - amount * (covered - 1))}` : ""
                    }.`}
            </p>
          )}

          {state?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={pending || tooMuch || !amount}
              className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50">
              {pending ? "Saving…" : "Set up salary"}
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

export function PayButton({ planId, month, amount }: { planId: string; month: string; amount: number }) {
  const [state, action, pending] = useActionState(paySalary, null as SalaryResult | null);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="month" value={month} />
      {state?.error && <span className="text-xs text-red-700">{state.error}</span>}
      <button type="submit" disabled={pending}
        className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-60">
        {pending ? "Paying…" : `Pay ${money(amount)}`}
      </button>
    </form>
  );
}

export function PayAllButton({ month, total }: { month: string; total: number }) {
  const [state, action, pending] = useActionState(payAllDue, null as SalaryResult | null);
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-3">
      <input type="hidden" name="month" value={month} />
      {state?.skipped?.length ? (
        <span className="text-xs text-amber-800">{state.skipped.join(" · ")}</span>
      ) : null}
      <button type="submit" disabled={pending || total <= 0}
        className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--hover)] disabled:opacity-50">
        {pending ? "Paying…" : `Pay everyone due · ${money(total)}`}
      </button>
    </form>
  );
}

export function UndoPayment({ id }: { id: string }) {
  return (
    <button type="button" onClick={() => undoSalaryPayment(id)}
      className="text-xs text-[var(--muted)] hover:text-red-700">
      Undo
    </button>
  );
}

export function StopPlan({ id }: { id: string }) {
  return (
    <button type="button" onClick={() => stopSalaryPlan(id)}
      className="text-xs text-[var(--muted)] hover:text-red-700">
      Stop
    </button>
  );
}
