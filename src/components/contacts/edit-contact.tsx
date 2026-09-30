"use client";

import { Card } from "@/components/ui";
import { ContactForm, type ContactFields } from "./contact-form";

export function EditContact({ contact, base }: { contact: ContactFields & { id: string }; base: string }) {
  return <Card className="px-5 py-5"><ContactForm contact={contact} base={base} /></Card>;
}
