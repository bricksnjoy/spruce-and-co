"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markBillsPaid } from "@/app/actions/project-bills";

type Account = { id: string; name: string };

/** An unpaid bill's status as a menu: pick the account it was paid from to mark it paid, on its own date. */
export function BillStatusMenu({ projectId, billId, label, payFrom }: { projectId: string; billId: string; label: string; payFrom: Account[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const overdue = label === "overdue";
  return (
    <span className="inline-flex flex-col items-end">
      <select aria-label="Receipt status" value="" disabled={pending}
        onChange={(e) => {
          const bank = e.target.value;
          if (!bank) return;
          start(async () => {
            const r = await markBillsPaid(projectId, [billId], bank);
            setError(r.error ?? r.failed?.[0] ?? null);
            router.refresh();
          });
        }}
        className={`rounded-full border-0 py-0.5 pl-2.5 pr-7 text-xs font-medium ${overdue ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
        <option value="">{pending ? "Saving…" : overdue ? "Overdue" : "Unpaid"}</option>
        <optgroup label="Mark paid from">
          {payFrom.map((a) => <option key={a.id} value={a.id}>Paid from {a.name}</option>)}
        </optgroup>
      </select>
      {error && <span className="mt-1 text-xs text-red-700">{error}</span>}
    </span>
  );
}

/** Mark every unpaid bill on the project paid from one account, each on its own date. */
export function MarkAllPaid({ projectId, billIds, payFrom }: { projectId: string; billIds: string[]; payFrom: Account[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [bank, setBank] = useState(payFrom[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  // once all are paid the button goes, but the message of what was done stays
  if (!billIds.length) return msg ? <span className="text-xs text-[var(--muted)]">{msg}</span> : null;
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <select aria-label="Mark all paid from" value={bank} onChange={(e) => setBank(e.target.value)}
        className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 text-xs">
        {payFrom.map((a) => <option key={a.id} value={a.id}>from {a.name}</option>)}
      </select>
      <button type="button" disabled={pending || !bank}
        className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-medium hover:bg-[var(--hover)]"
        onClick={() => {
          if (!confirm(`Mark all ${billIds.length} unpaid receipts as paid, each on its own date?`)) return;
          start(async () => {
            const r = await markBillsPaid(projectId, billIds, bank);
            setMsg(r.error ?? (r.failed?.length ? `${r.paid} marked paid; ${r.failed.length} not: ${r.failed[0]}` : `${r.paid} marked paid.`));
            router.refresh();
          });
        }}>
        {pending ? "Saving…" : `Mark all ${billIds.length} as paid`}
      </button>
      {msg && <span className="text-[var(--muted)]">{msg}</span>}
    </span>
  );
}
