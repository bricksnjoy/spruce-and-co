import type { Session } from "./session";

/**
 * Documents deleted to the bin (bills and invoices) and the payments deleted
 * with them: they stay void on record but leave every list.
 */
export async function deletedDocs(s: Session): Promise<Set<string>> {
  const { data } = await s.supabase.from("bill_bin").select("bill_id, payments");
  return new Set(((data ?? []) as { bill_id: string; payments: string[] }[]).flatMap((b) => [b.bill_id, ...b.payments]));
}
