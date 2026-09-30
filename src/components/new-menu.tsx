"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Item = [href: string, label: string];
type Group = { title: string; items: Item[] };

/** "+ New" (§9 Global): every form that creates something, grouped as the spec lists them. */
export function NewMenu({ canWrite, canPayroll, live }: { canWrite: boolean; canPayroll: boolean; live: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  if (!canWrite) return null;
  const groups: Group[] = [
    { title: "Customers", items: [["/sales/new?type=invoice", "Invoice"], ["/sales/payments/new", "Receive payment"], ["/sales/new?type=sales_receipt", "Sales receipt"],
      ["/sales/new?type=credit_note", "Credit note"], ["/sales/deposits/new", "Bank deposit"], ["/sales/advances", "Customer advance"],
      ...(live ? [["/quotations/new", "Estimate / quotation"] as Item] : []), ["/sales/customers", "Customer"]] },
    { title: "Vendors", items: [["/expenses/new?type=bill", "Bill"], ["/expenses/pay", "Pay bills"], ["/expenses/new?type=expense", "Expense"],
      ["/expenses/new?type=vendor_credit", "Vendor credit"], ["/expenses/new?type=purchase_order", "Purchase order"], ["/expenses/vendors", "Vendor"]] },
    ...(canPayroll ? [{ title: "Employees", items: [["/payroll", "Payroll run"], ["/payroll/employees", "Employee"], ["/payroll/remittances", "Pay pension / tax"]] as Item[] }] : []),
    { title: "Projects & financing", items: [["/projects/new", "Project"], ["/partners", "Pay out to a partner"], ["/taxes", "File or pay GST"]] },
    { title: "Other", items: [["/accounting/journal/new", "Journal entry"], ["/accounting/journal/new?type=opening_balance", "Opening balances"],
      ["/banking", "Transfer / bank import"], ["/accounting/chart", "Account"]] },
  ];
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)]">+ New</button>
      {open && (
        <div role="menu" className="absolute left-0 z-40 mt-2 grid w-[min(92vw,44rem)] gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg sm:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{g.title}</p>
              <ul className="space-y-0.5">
                {g.items.map(([href, label]) => (
                  <li key={href}><Link href={href} role="menuitem" onClick={() => setOpen(false)} className="block rounded-md px-2 py-1 text-sm hover:bg-[var(--brand-soft)]">{label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
