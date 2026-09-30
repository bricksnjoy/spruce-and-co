"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { primary } from "@/components/form-styles";
import { ContactForm, blankContact } from "./contact-form";

export function NewContact({ kind, base, singular }: { kind: string; base: string; singular: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={primary}>New {singular}</button>;
  return (
    <Card>
      <CardHeader title={`New ${singular}`} subtitle="Added to the book you are working in" />
      <div className="px-5 py-5"><ContactForm contact={blankContact(kind)} base={base} onDone={() => setOpen(false)} /></div>
    </Card>
  );
}
