/** Customers and vendors share one contact list; these say which side a screen shows. */
export type Side = {
  kind: "customer" | "vendor";
  title: string;
  singular: string;
  base: string;
  owedLabel: string;
  owedKey: "receivable" | "payable";
  overdueKey: "overdue_receivable" | "overdue_payable";
  docTypes: string[];
};

export const CUSTOMERS: Side = {
  kind: "customer", title: "Customers", singular: "customer", base: "/sales/customers",
  owedLabel: "Owes you", owedKey: "receivable", overdueKey: "overdue_receivable",
  docTypes: ["estimate", "invoice", "credit_note", "sales_receipt", "customer_payment", "customer_advance", "advance_application", "bad_debt", "deposit"],
};

export const VENDORS: Side = {
  kind: "vendor", title: "Vendors", singular: "vendor", base: "/expenses/vendors",
  owedLabel: "You owe", owedKey: "payable", overdueKey: "overdue_payable",
  docTypes: ["purchase_order", "bill", "vendor_credit", "bill_payment", "expense"],
};
