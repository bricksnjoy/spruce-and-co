"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { input, label, hint, primary } from "@/components/form-styles";
import { saveAccountingSettings, type Result } from "@/app/actions/settings";
import { dateTime } from "@/lib/format";

export type AccountingSettings = {
  closing_date: string | null;
  closing_date_set_at: string | null;
  opening_balance_date: string;
  fiscal_year_start_month: number;
  gst_period_months: number;
  gst_due_day: number;
  recognition_default: string;
  profit_share_debit: string;
  nopay_days_divisor: string;
  approval_limit_bill: string;
  gst_registered: boolean;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function AccountingForm({ settings, canEdit }: { settings: AccountingSettings; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveAccountingSettings, null as Result | null);

  return (
    <form action={action} className="space-y-6">
      {!canEdit && (
        <p className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted)]">Only an admin can change these.</p>
      )}
      <fieldset disabled={!canEdit} className="space-y-6">
        <Card>
          <CardHeader title="Closing the books" subtitle="Nothing dated on or before the closing date can be added, changed or voided" />
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <div>
              <label htmlFor="closing_date" className={label}>Closing date</label>
              <input id="closing_date" name="closing_date" type="date" defaultValue={settings.closing_date ?? ""} className={input} />
              <p className={hint}>
                {settings.closing_date_set_at ? `Last moved ${dateTime(settings.closing_date_set_at)}. ` : ""}
                Leave blank to keep every period open.
              </p>
            </div>
            <div>
              <label htmlFor="opening_balance_date" className={label}>Opening balance date</label>
              <input id="opening_balance_date" name="opening_balance_date" type="date" required defaultValue={settings.opening_balance_date} className={input} />
              <p className={hint}>The day the new books start from</p>
            </div>
            <div>
              <label htmlFor="fiscal_year_start_month" className={label}>Financial year starts in</label>
              <select id="fiscal_year_start_month" name="fiscal_year_start_month" defaultValue={settings.fiscal_year_start_month} className={input}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Projects and profit share" />
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <div>
              <label htmlFor="recognition_default" className={label}>Project revenue is recognised</label>
              <select id="recognition_default" name="recognition_default" defaultValue={settings.recognition_default} className={input}>
                <option value="billing">As it is billed</option>
                <option value="poc">By percentage of completion</option>
              </select>
              <p className={hint}>The default for new projects; each project can choose its own</p>
            </div>
            <div>
              <label htmlFor="profit_share_debit" className={label}>Partners&apos; profit shares are charged to</label>
              <select id="profit_share_debit" name="profit_share_debit" defaultValue={settings.profit_share_debit} className={input}>
                <option value="expense">Profit Share (an expense)</option>
                <option value="dividends">Dividends (equity)</option>
              </select>
            </div>
            <div>
              <label htmlFor="approval_limit_bill" className={label}>Bills above this need approval</label>
              <input id="approval_limit_bill" name="approval_limit_bill" inputMode="decimal" defaultValue={settings.approval_limit_bill} className={`${input} tabular-nums`} placeholder="No limit" />
              <p className={hint}>MVR. Leave blank for no approval step.</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="GST returns" subtitle={settings.gst_registered ? "Registered for GST" : "Not registered for GST"} />
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <div>
              <label htmlFor="gst_period_months" className={label}>Returns are filed</label>
              <select id="gst_period_months" name="gst_period_months" defaultValue={settings.gst_period_months} className={input}>
                <option value={3}>Quarterly</option>
                <option value={1}>Monthly</option>
              </select>
            </div>
            <div>
              <label htmlFor="gst_due_day" className={label}>Due on day</label>
              <input id="gst_due_day" name="gst_due_day" type="number" min={1} max={28} required defaultValue={settings.gst_due_day} className={input} />
              <p className={hint}>Of the month after the period ends</p>
            </div>
            <p className="text-xs text-[var(--muted)] sm:col-span-2">
              Whether the company is registered is set on the <Link href="/settings/company" className="font-medium text-[var(--brand)] hover:underline">Company</Link> tab.
              Rates are on <Link href="/settings/taxes" className="font-medium text-[var(--brand)] hover:underline">Taxes &amp; rates</Link>.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Payroll" />
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <div>
              <label htmlFor="nopay_days_divisor" className={label}>Days in a month for no-pay</label>
              <input id="nopay_days_divisor" name="nopay_days_divisor" inputMode="decimal" required defaultValue={settings.nopay_days_divisor} className={`${input} tabular-nums`} />
              <p className={hint}>A day&apos;s no-pay is basic salary divided by this</p>
            </div>
          </div>
        </Card>

        {canEdit && (
          <div className="flex items-center gap-4">
            <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : "Save settings"}</button>
            {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
            {state?.ok && <p className="text-sm text-[var(--muted)]">Saved.</p>}
          </div>
        )}
      </fieldset>
    </form>
  );
}
