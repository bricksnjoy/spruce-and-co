"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { MoneyInput } from "@/components/money-input";
import { input, label, primary } from "@/components/form-styles";
import { recordFinancing } from "@/app/actions/partners";

type Entry = { id: string; type: string; profit_percent?: number | string | null; date: string; due_date: string | null; contact_id: string | null; bank_account_id: string | null; total_amount: number | string | null; reference: string | null };
type Who = { id: string; name: string; profit_percent?: number | string | null };

/** A pencil on a financing entry: who, where, when and how much, changed in a pop-up. */
export function EditFinancingButton({ projectId, entry, who, banks }: {
  projectId: string; entry: Entry; who: Who[]; banks: { id: string; code: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [contact, setContact] = useState(entry.contact_id ?? "");
  const router = useRouter();
  const days = entry.due_date ? Math.round((Date.parse(entry.due_date) - Date.parse(entry.date)) / 86_400_000) : null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Edit" title="Edit"
        className="relative z-[1] inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]">
        <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </button>
      {open && (
        <Modal title="Edit financing" size="md" onClose={() => setOpen(false)}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await recordFinancing(null, fd);
              if (r.error) { setError(r.error); return; }
              setOpen(false);
              router.refresh();
            });
          }} className="grid gap-4 text-left sm:grid-cols-2">
            <input type="hidden" name="id" value={entry.id} />
            <input type="hidden" name="type" value={entry.type} />
            <input type="hidden" name="project_id" value={projectId} />
            <div><label htmlFor="ef-who" className={label}>{entry.type === "loan_receipt" ? "Lender" : "Member"}</label>
              <select id="ef-who" name="contact_id" required value={contact} onChange={(e) => setContact(e.target.value)} className={input}>
                {who.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label htmlFor="ef-bank" className={label}>Paid into</label>
              <select id="ef-bank" name="bank_id" required defaultValue={entry.bank_account_id ?? ""} className={input}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select></div>
            <div><label htmlFor="ef-date" className={label}>Date received</label>
              <input id="ef-date" name="date" type="date" required defaultValue={entry.date} className={input} /></div>
            <div><label htmlFor="ef-amt" className={label}>Amount (MVR)</label>
              <MoneyInput id="ef-amt" name="amount" required defaultValue={Number(entry.total_amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} className={`${input} tabular-nums`} /></div>
            <div><label htmlFor="ef-ref" className={label}>Reference</label>
              <input id="ef-ref" name="reference" defaultValue={entry.reference ?? ""} className={input} /></div>
            <div><label htmlFor="ef-pct" className={label}>Profit share (%)</label>
              <input id="ef-pct" name="profit_percent" inputMode="decimal" placeholder="20" defaultValue={entry.profit_percent == null ? "" : String(Number(entry.profit_percent))} className={`${input} tabular-nums`} />
              <p className="mt-1 text-xs text-[var(--muted)]">For this loan only. Blank is 20%.</p></div>
            {days !== null && (
              <div><label htmlFor="ef-days" className={label}>Repay within (days)</label>
                <input id="ef-days" name="terms_days" inputMode="numeric" defaultValue={String(days)} className={`${input} tabular-nums`} /></div>
            )}
            <div className="flex items-center gap-3 sm:col-span-2">
              <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Save changes"}</button>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-[var(--muted)] hover:underline">Cancel</button>
              {error && <p className="text-sm text-red-700">{error}</p>}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
