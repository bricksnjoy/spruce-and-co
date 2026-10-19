const SALES = ["invoice", "credit_note", "sales_receipt", "customer_payment", "customer_advance", "advance_application", "bad_debt", "deposit"];
const EXPENSES = ["bill", "vendor_credit", "bill_payment", "expense", "purchase_order"];

/** Where a document is shown, by its type; null for entries that have no page of their own yet. */
export function docHref(type: string | null | undefined, id: string): string | null {
  if (!type) return null;
  if (SALES.includes(type)) return `/sales/${id}`;
  if (EXPENSES.includes(type)) return `/expenses/${id}`;
  return null;
}
