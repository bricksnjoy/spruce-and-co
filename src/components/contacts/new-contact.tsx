"use client";

import { useCallback, useState } from "react";
import { primary } from "@/components/form-styles";
import { Modal } from "@/components/modal";
import { ContactForm, blankContact } from "./contact-form";

/** "New customer / vendor / lender": the form opens in a pop-up over the list. */
export function NewContact({ kind, base, singular }: { kind: string; base: string; singular: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primary}>New {singular}</button>
      {open && (
        <Modal title={`New ${singular}`} size="md" onClose={close}>
          <ContactForm contact={blankContact(kind)} base={base} onDone={close} lenderChoice={kind === "lender"} />
        </Modal>
      )}
    </>
  );
}
