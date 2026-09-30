"use client";

import { useActionState, useEffect, useRef } from "react";
import { addClient } from "@/app/actions/clients";
import type { ClientResult } from "@/app/actions/clients";

export interface ClientValues {
  id?: string;
  name?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-sm font-medium";

/**
 * Add a customer. `onSaved` receives the row so a caller — the project form,
 * for instance — can select the customer it just created.
 */
export function ClientModal({
  open,
  onClose,
  onSaved,
  values,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (client: { id: string; name: string }) => void;
  values?: ClientValues;
}) {
  const editing = false;   // customers are edited on their own page now
  const [state, action, pending] = useActionState(addClient, null as ClientResult | null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      if (state.id && state.name) onSaved?.({ id: state.id, name: state.name });
      formRef.current?.reset();
      onClose();
    }
    // onSaved/onClose are stable callers here; reacting to state alone is what
    // keeps this from firing on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // close on Escape, the way a dialog is expected to behave
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "Edit customer" : "Add new customer"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--field)] shadow-[0_24px_60px_-20px_rgba(13,27,42,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold">
            {editing ? "Edit customer" : "Add new customer"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form ref={formRef} action={action} className="space-y-4 px-5 py-5">
          {values?.id && <input type="hidden" name="id" value={values.id} />}

          <div>
            <label htmlFor="client-name" className={label}>Customer name</label>
            <input id="client-name" name="name" required autoFocus
              defaultValue={values?.name ?? ""} className={input}
              placeholder="Ministry Of Youth" />
          </div>

          <div>
            <label htmlFor="client-address" className={label}>Address</label>
            <textarea id="client-address" name="address" rows={2}
              defaultValue={values?.address ?? ""} className={input}
              placeholder="Malé, Maldives" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="client-phone" className={label}>Phone number</label>
              <input id="client-phone" name="phone" type="tel"
                defaultValue={values?.phone ?? ""} className={input}
                placeholder="+960 000 0000" />
            </div>
            <div>
              <label htmlFor="client-email" className={label}>Mail</label>
              <input id="client-email" name="email" type="email"
                defaultValue={values?.email ?? ""} className={input}
                placeholder="name@example.mv" />
            </div>
          </div>

          {state?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={pending}
              className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-60">
              {pending ? "Saving…" : editing ? "Save changes" : "Add customer"}
            </button>
            <button type="button" onClick={onClose}
              className="text-sm text-[var(--muted)] hover:underline">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
