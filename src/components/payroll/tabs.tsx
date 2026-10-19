import Link from "next/link";

const TABS: [string, string][] = [["/payroll", "Payroll runs"], ["/payroll/employees", "Employees"], ["/payroll/remittances", "Pension & tax"]];

export function PayrollTabs({ active }: { active: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--border)]">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${active === href ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>{label}</Link>
      ))}
    </div>
  );
}
