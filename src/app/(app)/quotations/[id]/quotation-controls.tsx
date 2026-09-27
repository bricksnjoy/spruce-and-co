"use client";

import { useActionState, useEffect, useState } from "react";
import {
  convertToInvoice,
  deleteQuotation,
  setQuotationStatus,
  type DocResult,
} from "@/app/actions/documents";
import { QUOTE_STATUSES, QUOTE_STATUS_LABEL, STATUS_TONE, addDays, round2, type QuoteStatus, type SigningKit } from "@/lib/documents";
import { SignerPicker } from "../quotation-form";
import { money, today } from "@/lib/format";

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-sm font-medium";

/** One press moves the quotation along: sent, won, lost and so on. */
export function StatusPicker({ id, status }: { id: string; status: QuoteStatus }) {
  const [pending, setPending] = useState<QuoteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(s: QuoteStatus) {
    if (s === status) return;
    setPending(s);
    setError(null);
    const r = await setQuotationStatus(id, s);
    setPending(null);
    if (r.error) setError(r.error);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {QUOTE_STATUSES.map((s) => (
          <button key={s} type="button" onClick={() => pick(s)} disabled={pending !== null}
            aria-pressed={s === status}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
              s === status
                ? `${STATUS_TONE[s]} ring-1 ring-current`
                : "border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}>
            {pending === s ? "…" : QUOTE_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function DeleteQuotation({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button type="button"
        onClick={async () => {
          if (!confirm("Delete this quotation? This cannot be undone.")) return;
          const r = await deleteQuotation(id);
          if (r?.error) setError(r.error);
        }}
        className="text-xs text-[var(--muted)] hover:text-red-700">
        Delete
      </button>
    </span>
  );
}

export interface InvoiceTemplateOption {
  id: string;
  name: string;
  is_default: boolean;
  due_days: number;
}

/**
 * Turn a won quotation into an invoice — for a percentage of it (the advance,
 * the balance) or a set amount — without going past what is left to bill.
 */
export function ConvertButton({
  quotationId,
  subtotal,
  invoiced,
  taxRate,
  templates,
  kit,
  signatoryId,
  showStamp,
}: {
  quotationId: string;
  subtotal: number;
  invoiced: number;
  taxRate: number;
  templates: InvoiceTemplateOption[];
  kit: SigningKit;
  /** the quotation's signer, offered first for its invoices */
  signatoryId: string | null;
  showStamp: boolean;
}) {
  const [open, setOpen] = useState(false);
  const remaining = round2(subtotal - invoiced);
  if (remaining <= 0.005) {
    return <span className="text-xs font-medium text-emerald-700">Fully invoiced</span>;
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)]">
        Convert to invoice
      </button>
      {open && (
        <ConvertModal quotationId={quotationId} subtotal={subtotal} remaining={remaining} taxRate={taxRate}
          templates={templates} kit={kit} signatoryId={signatoryId} showStamp={showStamp}
          onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ConvertModal({
  quotationId,
  subtotal,
  remaining,
  taxRate,
  templates,
  kit,
  signatoryId,
  showStamp,
  onClose,
}: {
  quotationId: string;
  subtotal: number;
  remaining: number;
  taxRate: number;
  templates: InvoiceTemplateOption[];
  kit: SigningKit;
  signatoryId: string | null;
  showStamp: boolean;
  onClose: () => void;
}) {
  const [signer, setSigner] = useState(signatoryId);
  const [stamp, setStamp] = useState(showStamp);
  const [state, action, pending] = useActionState(convertToInvoice, null as DocResult | null);
  const remainingPct = (remaining / subtotal) * 100;
  const fresh = remaining >= subtotal - 0.005;
  const [basis, setBasis] = useState<"percent" | "amount">("percent");
  // nothing billed yet: suggest the usual advance; otherwise, whatever is left
  const [value, setValue] = useState(fresh ? "75" : String(Number(remainingPct.toFixed(2))));
  const [templateId, setTemplateId] = useState(templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? "");
  const todayIso = today();
  const [issue, setIssue] = useState(todayIso);
  const dueDays = templates.find((t) => t.id === templateId)?.due_days ?? 0;

  const v = Number(value) || 0;
  const amount = round2(basis === "percent" ? (subtotal * v) / 100 : v);
  const pct = subtotal > 0 ? (amount / subtotal) * 100 : 0;
  const over = amount > remaining + 0.005;
  const withTax = round2(amount + (amount * taxRate) / 100);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Convert to invoice"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--field)] shadow-[0_24px_60px_-20px_rgba(13,27,42,0.4)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Convert to invoice</h2>
            <p className="text-xs text-[var(--muted)]">
              {money(remaining)} of {money(subtotal)} left to invoice ({Number(remainingPct.toFixed(2))}%)
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--muted)] hover:text-[var(--text)]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form action={action} className="space-y-4 px-5 py-5">
          <input type="hidden" name="quotation_id" value={quotationId} />
          <input type="hidden" name="basis" value={basis} />

          <div role="radiogroup" className="flex rounded-lg border border-[var(--border)] p-0.5 text-sm font-medium">
            {(["percent", "amount"] as const).map((b) => (
              <button key={b} type="button" role="radio" aria-checked={basis === b}
                onClick={() => {
                  setBasis(b);
                  setValue(b === "percent" ? String(Number(pct.toFixed(2))) : amount.toFixed(2));
                }}
                className={`flex-1 rounded-md px-3 py-1.5 ${basis === b ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}>
                {b === "percent" ? "Percentage" : "Custom amount"}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="c-value" className={label}>{basis === "percent" ? "Percentage of the quotation" : "Amount (before tax)"}</label>
            <div className="flex items-center gap-2">
              <input id="c-value" name="value" type="number" step="0.01" min="0" required autoFocus
                value={value} onChange={(e) => setValue(e.target.value)} className={input} />
              <span className="text-sm text-[var(--muted)]">{basis === "percent" ? "%" : "MVR"}</span>
            </div>
            {basis === "percent" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[25, 30, 50, 70, 75, 100].filter((p) => p <= remainingPct + 0.005).map((p) => (
                  <button key={p} type="button" onClick={() => setValue(String(p))}
                    className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs hover:bg-[var(--hover)]">
                    {p}%
                  </button>
                ))}
                {!fresh && (
                  <button type="button" onClick={() => setValue(String(Number(remainingPct.toFixed(4))))}
                    className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs hover:bg-[var(--hover)]">
                    The rest
                  </button>
                )}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="c-label" className={label}>Label</label>
            <input id="c-label" name="label" className={input}
              placeholder={fresh ? `Advance_${Number(pct.toFixed(2))}%` : `Balance_${Number(pct.toFixed(2))}%`} />
            <p className="mt-1 text-xs text-[var(--muted)]">Added to the heading — leave empty to use the percentage.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="c-date" className={label}>Invoice date</label>
              <input id="c-date" name="issue_date" type="date" value={issue} onChange={(e) => setIssue(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="c-due" className={label}>Due date</label>
              <input id="c-due" name="due_date" type="date" key={`${issue}-${dueDays}`}
                defaultValue={dueDays ? addDays(issue || todayIso, dueDays) : ""} className={input} />
            </div>
          </div>

          {templates.length > 1 && (
            <div>
              <label htmlFor="c-template" className={label}>Invoice template</label>
              <select id="c-template" name="template_id" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={input}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>
                ))}
              </select>
            </div>
          )}
          {templates.length <= 1 && <input type="hidden" name="template_id" value={templateId} />}

          <div>
            <p className={label}>Signed by</p>
            <SignerPicker kit={kit} signatoryId={signer} showStamp={stamp} onSigner={setSigner} onStamp={setStamp}
              names={{ signer: "signatory_id", stamp: "show_stamp" }} />
          </div>

          <p className={`rounded-lg px-3 py-2 text-sm ${over ? "bg-red-50 text-red-700" : "bg-[var(--hover)]"}`}>
            {over ? (
              <>That is more than the {money(remaining)} left to invoice.</>
            ) : (
              <>
                Invoicing <span className="font-medium">{money(amount)}</span> ({Number(pct.toFixed(2))}%)
                {taxRate > 0 && <> · {money(withTax)} with tax</>}
                {" · "}
                {money(round2(remaining - amount))} left after
              </>
            )}
          </p>

          {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending || over || amount <= 0}
              className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-50">
              {pending ? "Creating…" : "Create invoice"}
            </button>
            <button type="button" onClick={onClose} className="text-sm text-[var(--muted)] hover:underline">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
