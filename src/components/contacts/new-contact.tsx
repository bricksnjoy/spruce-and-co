"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearDraft, hasDraft } from "@/lib/form-draft";
import { primary } from "@/components/form-styles";
import { Modal } from "@/components/modal";
import { ContactForm, blankContact } from "./contact-form";

/** "New customer / vendor / lender": the form opens in a pop-up over the list. */
export function NewContact({ kind, base, singular, directors }: { kind: string; base: string; singular: string; directors?: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const draft = `new-contact:${kind}`;
  // unsaved typing from before a refresh: open the pop-up again with it
  useEffect(() => {
    const t = setTimeout(() => { if (hasDraft(draft)) setOpen(true); });
    return () => clearTimeout(t);
  }, [draft]);
  const close = useCallback(() => setOpen(false), []);
  const router = useRouter();
  // once added, stay on the list: the pop-up closes and the list shows them
  const added = useCallback(() => { setOpen(false); router.refresh(); }, [router]);
  const discard = useCallback(() => { clearDraft(draft); setOpen(false); }, [draft]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primary}>New {singular}</button>
      {open && (
        <Modal title={`New ${singular}`} size="md" onClose={discard}>
          <ContactForm contact={blankContact(kind)} base={base} onDone={close} onCreated={added} lenderChoice={kind === "lender"} directors={directors} />
        </Modal>
      )}
    </>
  );
}
