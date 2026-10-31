"use client";

import { deleteFinancing } from "@/app/actions/partners";
import { ConfirmDelete } from "@/components/confirm-delete";

/** A bin icon on a financing entry: takes the loan or contribution out of the books after asking. */
export function DeleteFinancingButton({ id, number }: { id: string; number: string | null }) {
  const name = number ?? "this financing";
  return <ConfirmDelete label={`Delete ${name}`} title={`Delete ${name}?`}
    body="It is taken out of the books: the money leaves the bank account and the project's financing, and the lender no longer has it in this project."
    onDelete={() => deleteFinancing(id)} />;
}
