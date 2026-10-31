"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { ContactForm, type ContactFields } from "./contact-form";

/** A pencil on a lender's row: their name and contact details, changed in a pop-up. */
export function EditLenderButton({ contact }: { contact: ContactFields & { id: string } }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const close = useCallback(() => setOpen(false), []);
  const saved = useCallback(() => { setOpen(false); router.refresh(); }, [router]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Edit ${contact.name}`} title="Edit"
        className="relative z-[1] inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]">
        <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </button>
      {open && (
        <Modal title={`Edit ${contact.name}`} size="md" onClose={close}>
          <ContactForm contact={contact} base="/partners" onDone={saved} lenderEdit />
        </Modal>
      )}
    </>
  );
}
