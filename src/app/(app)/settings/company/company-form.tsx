"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { saveCompany, type Company, type CompanyResult } from "@/app/actions/company";

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-sm font-medium";
const hint = "mt-1 text-xs text-[var(--muted)]";

export function CompanyForm({ company }: { company: Company }) {
  const [state, action, pending] = useActionState(saveCompany, null as CompanyResult | null);

  return (
    <form action={action} className="space-y-6">
      <Card>
        <CardHeader title="Registered details" subtitle="As they appear on your company profile" />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="legal_name" className={label}>Registered name</label>
            <input id="legal_name" name="legal_name" required
              defaultValue={company.legal_name} className={input} />
          </div>
          <div>
            <label htmlFor="trade_name" className={label}>Trading name</label>
            <input id="trade_name" name="trade_name" defaultValue={company.trade_name ?? ""}
              className={input} placeholder="Spruce & Co" />
            <p className={hint}>What appears around this system</p>
          </div>
          <div>
            <label htmlFor="registration_no" className={label}>Registration number</label>
            <input id="registration_no" name="registration_no"
              defaultValue={company.registration_no ?? ""} className={`${input} font-mono`} />
          </div>
          <div>
            <label htmlFor="uei" className={label}>Unique Entity Identifier</label>
            <input id="uei" name="uei" defaultValue={company.uei ?? ""}
              className={`${input} font-mono`} />
          </div>
          <div>
            <label htmlFor="tin" className={label}>TIN</label>
            <input id="tin" name="tin" defaultValue={company.tin ?? ""}
              className={`${input} font-mono`} />
            <p className={hint}>Issued by MIRA</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="GST"
          subtitle="What the input schedule files under"
        />
        <div className="space-y-4 px-5 py-5">
          <label className="flex items-start gap-3">
            <input type="checkbox" name="gst_registered"
              defaultChecked={company.gst_registered}
              className="mt-0.5 h-4 w-4 rounded border-[var(--border)]" />
            <span className="text-sm">
              Registered for GST
              <span className="block text-xs text-[var(--muted)]">
                Input tax on your bills can only be claimed while this is true. Registration
                is required once taxable supplies pass MVR 1 million a year.
              </span>
            </span>
          </label>

          <div className="sm:w-1/2">
            <label htmlFor="taxable_activity_no" className={label}>Taxable activity number</label>
            <input id="taxable_activity_no" name="taxable_activity_no"
              defaultValue={company.taxable_activity_no ?? ""}
              className={`${input} font-mono`} placeholder="1178331GST501" />
            <p className={hint}>
              From your GST registration certificate. It fills itself in on every bill from here.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Contact" subtitle="Carried onto filings and invoices" />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="address" className={label}>Address</label>
            <textarea id="address" name="address" rows={2}
              defaultValue={company.address ?? ""} className={input} />
          </div>
          <div>
            <label htmlFor="phone" className={label}>Phone</label>
            <input id="phone" name="phone" type="tel" defaultValue={company.phone ?? ""}
              className={input} placeholder="+960 000 0000" />
          </div>
          <div>
            <label htmlFor="email" className={label}>Mail</label>
            <input id="email" name="email" type="email" defaultValue={company.email ?? ""}
              className={input} placeholder="accounts@spruce.mv" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="bank_details" className={label}>Bank details</label>
            <textarea id="bank_details" name="bank_details" rows={2}
              defaultValue={company.bank_details ?? ""} className={input}
              placeholder="BML · Account name · Account number" />
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending}
          className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-60">
          {pending ? "Saving…" : "Save details"}
        </button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && <p className="text-sm text-[var(--muted)]">Saved.</p>}
      </div>
    </form>
  );
}
