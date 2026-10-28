import { dbMessage, type Session } from "./session";

/** Pay a receipt's whole balance from one account on a date; the error, if any. */
export async function payInFull(s: Session, bill: string, date: string, bank: string): Promise<string | null> {
  const { data } = await s.supabase.from("document_balances_v").select("balance").eq("id", bill).maybeSingle();
  if (!data || Number(data.balance) <= 0) return null;
  const { error } = await s.supabase.rpc("rpc_pay_bills", { p_bank: bank, p_date: date, p_items: [{ bill, amount: String(data.balance) }], p_reference: null });
  return error ? dbMessage(error) : null;
}
