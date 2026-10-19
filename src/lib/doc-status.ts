/**
 * A document's status, derived exactly as the database's document_status()
 * does, from the payments applied (§1): never stored.
 */
export type DocBalance = {
  type: string; total: number | string; applied: number | string; balance: number | string;
  due_date: string | null; is_draft: boolean; sent_at: string | null; voided_at: string | null;
};
export type DocStatus = "void" | "draft" | "posted" | "paid" | "overdue" | "partial" | "sent" | "open";

import { dbToLaari } from "./money";

export function docStatus(b: DocBalance, today: string): DocStatus {
  const total = dbToLaari(b.total), applied = dbToLaari(b.applied), balance = dbToLaari(b.balance);
  if (b.voided_at) return "void";
  if (b.is_draft) return "draft";
  if (b.type !== "invoice" && b.type !== "bill") return "posted";
  if (total > 0n && applied >= total) return "paid";
  if (balance > 0n && b.due_date !== null && b.due_date < today) return "overdue";
  if (applied > 0n) return "partial";
  if (b.sent_at) return "sent";
  return "open";
}
