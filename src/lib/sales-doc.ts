/** Shared by the server pages and the client form (a "use client" module cannot hand plain values to the server). */
import { addDays, today } from "@/lib/format";
import type { SalesFormData } from "@/server/sales-data";

export type DocType = "invoice" | "credit_note" | "sales_receipt";
/** A line with a description and no qty, rate or amount prints as a heading. */
export type LineValue = { item_no: string; description: string; qty: string; unit: string; rate: string; amount: string; tax_code_id: string; project_id: string; account_id: string };
export type DocValues = {
  id?: string; type: DocType; date: string; due_date: string; contact_id: string; project_id: string;
  currency: string; fx_rate: string; memo: string; reference: string; agr_no: string; po_no: string;
  /** who signs and whether it is stamped; "" and null follow the invoice template */
  signatory_id: string; show_stamp: boolean | null; bank_account_id: string; is_draft: boolean; lines: LineValue[];
};

export const TITLES: Record<DocType, string> = { invoice: "Invoice", credit_note: "Credit note", sales_receipt: "Sales receipt" };

export function blankDoc(type: DocType, data: SalesFormData, customerId = "", projectId = ""): DocValues {
  const t = today();
  const c = data.customers.find((x) => x.id === customerId);
  return {
    type, date: t, due_date: addDays(t, c?.terms_days ?? 0), contact_id: customerId, project_id: projectId, currency: "MVR", fx_rate: "1",
    memo: "", reference: "", agr_no: "", po_no: "", signatory_id: "", show_stamp: null, bank_account_id: "", is_draft: false,
    lines: [blankLine(data)],
  };
}

export const blankLine = (data: SalesFormData): LineValue =>
  ({ item_no: "", description: "", qty: "", unit: "", rate: "", amount: "", tax_code_id: data.defaultTaxCode ?? "", project_id: "", account_id: "" });
