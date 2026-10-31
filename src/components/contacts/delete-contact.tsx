"use client";

import { deleteContact } from "@/app/actions/contacts";
import { ConfirmDelete } from "@/components/confirm-delete";

/** A bin icon on a contact's row: deletes them after asking. */
export function DeleteContactButton({ id, name }: { id: string; name: string }) {
  return <ConfirmDelete label={`Delete ${name}`} title={`Delete ${name}?`} body="They are removed from the list. This can't be undone."
    onDelete={() => deleteContact(id)} />;
}
