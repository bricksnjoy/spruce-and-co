"use client";

import { startTransition, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { ContactForm, blankContact } from "@/components/contacts/contact-form";
import { input, label, primary } from "@/components/form-styles";
import { createBankAccount, type Result } from "@/app/actions/accounts";
import { createContact } from "@/app/actions/contacts";

type Kind = "bank" | "director" | "lender";
const KINDS: [Kind, string, string][] = [
  ["bank", "Company bank or cash account", "A bank account or cash box the company's money is kept in"],
  ["director", "Director's account", "A new director of the company"],
  ["lender", "Lender account", "Someone who lends money to projects"],
];

const submit = (action: (fd: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd));
};

/** People → Accounts: open a new company, director's or lender account. */
export function NewAccountButton({ directors }: { directors: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("bank");
  const router = useRouter();
  const done = () => { setOpen(false); router.refresh(); };
  const [bankState, bankAction, bankPending] = useActionState(async (prev: Result | null, fd: FormData) => {
    const r = await createBankAccount(prev, fd); if (r.ok) done(); return r;
  }, null);
  const [dirState, dirAction, dirPending] = useActionState(async (prev: Result | null, fd: FormData) => {
    const r = await createContact(prev, fd); if (r.ok) done(); return r;
  }, null);

  return (
    <>
      <button type="button" onClick={() => { setKind("bank"); setOpen(true); }} className={primary}>+ New account</button>
      {open && (
        <Modal title="New account" size="md" onClose={() => setOpen(false)}>
          <div className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-3">
              {KINDS.map(([k, l, h]) => (
                <label key={k} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${kind === k ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)]"}`}>
                  <input type="radio" name="account_kind" checked={kind === k} onChange={() => setKind(k)} className="mt-0.5" />
                  <span><span className="block font-medium">{l}</span><span className="block text-xs text-[var(--muted)]">{h}</span></span>
                </label>
              ))}
            </div>

            {kind === "bank" && (
              <form onSubmit={submit(bankAction)} className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2"><label htmlFor="na-name" className={label}>Name</label>
                  <input id="na-name" name="name" required placeholder="BML Wadiah Business Current" className={input} /></div>
                <div><label htmlFor="na-kind" className={label}>Kind</label>
                  <select id="na-kind" name="kind" className={input} defaultValue="bank"><option value="bank">Bank account</option><option value="cash">Cash</option></select></div>
                <div><label htmlFor="na-cur" className={label}>Currency</label>
                  <select id="na-cur" name="currency" className={input} defaultValue="MVR"><option>MVR</option><option>USD</option></select></div>
                <div className="sm:col-span-2"><label htmlFor="na-no" className={label}>Account number (optional)</label>
                  <input id="na-no" name="number" inputMode="numeric" placeholder="7770000188459" className={input} /></div>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <button type="submit" disabled={bankPending} className={primary}>{bankPending ? "Saving…" : "Add account"}</button>
                  {bankState?.error && <p className="text-sm text-red-700">{bankState.error}</p>}
                </div>
              </form>
            )}

            {kind === "director" && (
              <form onSubmit={submit(dirAction)} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="new_director" value="on" />
                <div className="sm:col-span-2"><label htmlFor="nd-name" className={label}>Name</label>
                  <input id="nd-name" name="name" required className={input} /></div>
                <div><label htmlFor="nd-phone" className={label}>Phone</label><input id="nd-phone" name="phone" className={input} /></div>
                <div><label htmlFor="nd-email" className={label}>Email</label><input id="nd-email" name="email" type="email" className={input} /></div>
                <p className="text-xs text-[var(--muted)] sm:col-span-2">Their share of each project&apos;s profit is set in Profit-share schemes.</p>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <button type="submit" disabled={dirPending} className={primary}>{dirPending ? "Saving…" : "Add director"}</button>
                  {dirState?.error && <p className="text-sm text-red-700">{dirState.error}</p>}
                </div>
              </form>
            )}

            {kind === "lender" && (
              <ContactForm contact={blankContact("lender")} base="/partners" lenderChoice directors={directors}
                onCreated={() => done()} onDone={() => setOpen(false)} />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
