import type { Session } from "./session";

export type OpenInvoice = { id: string; number: string | null; date: string; due_date: string | null; total: number; balance: number; contact_id: string; project_code: string | null };

/** Every posted invoice with something still owed, oldest first, for applying payments. */
export async function openInvoices(s: Session): Promise<OpenInvoice[]> {
  const { data } = await s.supabase.from("sales_list_v").select("id, number, date, due_date, total, balance, contact_id, project_code, status")
    .eq("type", "invoice").in("status", ["open", "sent", "partial", "overdue"]).order("due_date").order("date");
  return (data ?? []) as OpenInvoice[];
}
