"use client";

import { startTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { input, label, hint, primary } from "@/components/form-styles";
import { createContact, updateContact, type Result } from "@/app/actions/contacts";

export type ContactFields = {
  id?: string; kinds: string[]; name: string; company_name: string | null; contact_person: string | null;
  email: string | null; phone: string | null; address: string | null; tin: string | null; gst_registered: boolean;
  taxable_activity_no: string | null; bank_details: string | null; terms_days: number | null; currency: string;
  vendor_kind: string | null; trade: string | null; licence_expiry: string | null; insurance_expiry: string | null; notes: string | null;
};

export const blankContact = (kind: string): ContactFields => ({
  kinds: [kind], name: "", company_name: null, contact_person: null, email: null, phone: null, address: null, tin: null,
  gst_registered: false, taxable_activity_no: null, bank_details: null, terms_days: null, currency: "MVR",
  vendor_kind: kind === "vendor" ? "supplier" : null, trade: null, licence_expiry: null, insurance_expiry: null, notes: null,
});

/** Add or edit a customer, vendor or lender. `base` is where the new contact's page lives. */
export function ContactForm({ contact: c, base, onDone }: { contact: ContactFields; base: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState(c.id ? updateContact : createContact, null as Result | null);
  const router = useRouter();
  const isVendor = c.kinds.includes("vendor");

  useEffect(() => {
    if (!state?.ok) return;
    if (!c.id && state.id) router.push(`${base}/${state.id}`);
    else onDone?.();
  }, [state, c.id, base, router, onDone]);

  const f = (k: keyof ContactFields) => (c[k] == null ? "" : String(c[k]));
  return (
    // submitted by hand so a refusal (e.g. a duplicate) keeps what was typed
    <form className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }}>
      {c.id && <input type="hidden" name="id" value={c.id} />}
      <div className="sm:col-span-2">
        <label htmlFor="c-name" className={label}>Name</label>
        <input id="c-name" name="name" required defaultValue={c.name} className={input} />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className={label}>This contact is a</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {[["customer", "Customer"], ["vendor", "Vendor"], ["lender", "Lender"]].map(([k, l]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" name={`kind_${k}`} defaultChecked={c.kinds.includes(k)} className="h-4 w-4" /> {l}
            </label>
          ))}
          {c.kinds.includes("partner") && <span className="text-[var(--muted)]">Partner (set with the capital pool)</span>}
        </div>
      </fieldset>
      <div>
        <label htmlFor="c-person" className={label}>Contact person</label>
        <input id="c-person" name="contact_person" defaultValue={f("contact_person")} className={input} />
      </div>
      <div>
        <label htmlFor="c-company" className={label}>Registered company name</label>
        <input id="c-company" name="company_name" defaultValue={f("company_name")} className={input} />
      </div>
      <div>
        <label htmlFor="c-phone" className={label}>Phone</label>
        <input id="c-phone" name="phone" type="tel" defaultValue={f("phone")} className={input} />
      </div>
      <div>
        <label htmlFor="c-email" className={label}>Email</label>
        <input id="c-email" name="email" type="email" defaultValue={f("email")} className={input} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-address" className={label}>Address</label>
        <textarea id="c-address" name="address" rows={2} defaultValue={f("address")} className={input} />
      </div>

      <div>
        <label htmlFor="c-tin" className={label}>TIN</label>
        <input id="c-tin" name="tin" defaultValue={f("tin")} className={`${input} font-mono`} />
      </div>
      <div>
        <label htmlFor="c-tan" className={label}>GST taxable activity number</label>
        <input id="c-tan" name="taxable_activity_no" defaultValue={f("taxable_activity_no")} className={`${input} font-mono`} />
      </div>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="gst_registered" defaultChecked={c.gst_registered} className="mt-0.5 h-4 w-4" />
        <span>Registered for GST<span className="block text-xs text-[var(--muted)]">Input GST on their bills can only be claimed when this is ticked and their TIN is recorded.</span></span>
      </label>

      <div>
        <label htmlFor="c-terms" className={label}>Payment terms (days)</label>
        <input id="c-terms" name="terms_days" inputMode="numeric" defaultValue={f("terms_days")} className={`${input} tabular-nums`} placeholder="30" />
        <p className={hint}>Sets the due date on new invoices and bills</p>
      </div>
      <div>
        <label htmlFor="c-cur" className={label}>Currency</label>
        <select id="c-cur" name="currency" defaultValue={c.currency} className={input}><option>MVR</option><option>USD</option></select>
      </div>

      {isVendor && (
        <>
          <div>
            <label htmlFor="c-vkind" className={label}>Vendor kind</label>
            <select id="c-vkind" name="vendor_kind" defaultValue={c.vendor_kind ?? "supplier"} className={input}>
              <option value="supplier">Supplier</option><option value="subcontractor">Subcontractor</option>
              <option value="consultant">Consultant</option><option value="other">Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="c-trade" className={label}>Trade</label>
            <input id="c-trade" name="trade" defaultValue={f("trade")} className={input} placeholder="Joinery, electrical…" />
          </div>
          <div>
            <label htmlFor="c-lic" className={label}>Licence expires</label>
            <input id="c-lic" name="licence_expiry" type="date" defaultValue={f("licence_expiry")} className={input} />
          </div>
          <div>
            <label htmlFor="c-ins" className={label}>Insurance expires</label>
            <input id="c-ins" name="insurance_expiry" type="date" defaultValue={f("insurance_expiry")} className={input} />
          </div>
        </>
      )}
      <div className="sm:col-span-2">
        <label htmlFor="c-bank" className={label}>Bank details</label>
        <textarea id="c-bank" name="bank_details" rows={2} defaultValue={f("bank_details")} className={input} placeholder="Bank · Account name · Account number" />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-notes" className={label}>Notes</label>
        <textarea id="c-notes" name="notes" rows={2} defaultValue={f("notes")} className={input} />
      </div>
      {!c.id && state?.error && /already/.test(state.error) && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="allow_duplicate" className="h-4 w-4" /> Add anyway — it is a different contact
        </label>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : c.id ? "Save changes" : "Add contact"}</button>
        {onDone && <button type="button" onClick={onDone} className="text-sm text-[var(--muted)] hover:underline">Cancel</button>}
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        {state?.ok && c.id && <p className="text-sm text-[var(--muted)]">Saved.</p>}
      </div>
    </form>
  );
}
