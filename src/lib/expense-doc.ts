/** Shared by the server pages and the client form (a "use client" module cannot hand plain values to the server). */
import { addDays, today } from "@/lib/format";
import type { ExpenseFormData } from "@/server/expense-data";

export type ExpenseType = "bill" | "expense" | "vendor_credit" | "purchase_order";
export type ExpenseLine = { description: string; qty: string; rate: string; amount: string; tax_amount: string; gst_claimable: boolean; project_id: string; account_id: string };
export type ExpenseValues = {
  id?: string; type: ExpenseType; date: string; due_date: string; contact_id: string; project_id: string; bank_account_id: string;
  currency: string; fx_rate: string; memo: string; reference: string; supplier_tin: string; tax_invoice_no: string; tax_invoice_date: string;
  customs_ref: string; is_draft: boolean; lines: ExpenseLine[];
};
export const TITLES: Record<ExpenseType, string> = { bill: "Bill", expense: "Expense", vendor_credit: "Vendor credit", purchase_order: "Purchase order" };
export const blankLine = (): ExpenseLine => ({ description: "", qty: "", rate: "", amount: "", tax_amount: "", gst_claimable: true, project_id: "", account_id: "" });

export function blankExpense(type: ExpenseType, vendorId = "", projectId = "", data?: ExpenseFormData): ExpenseValues {
  const v = data?.vendors.find((x) => x.id === vendorId);
  const t = today();
  return { type, date: t, due_date: addDays(t, v?.terms_days ?? 0), contact_id: vendorId, project_id: projectId, bank_account_id: "", currency: "MVR", fx_rate: "1",
    memo: "", reference: "", supplier_tin: v?.tin ?? "", tax_invoice_no: "", tax_invoice_date: t, customs_ref: "", is_draft: false, lines: [blankLine()] };
}
