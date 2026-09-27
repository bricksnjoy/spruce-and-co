import Link from "next/link";
import { PERIODS, type Period } from "@/lib/accounting";

const TABS: [string, string][] = [
  ["/accounting", "Overview"],
  ["/accounting/ledger", "Ledger"],
  ["/accounting/statements", "Statements"],
  ["/accounting/audit", "Self-audit"],
];

/** The accounting pages, as tabs. */
export function AccountingTabs({ active }: { active: string }) {
  return (
    <div className="mb-5 flex gap-1 border-b border-[var(--border)]">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            active === href ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
          }`}>
          {label}
        </Link>
      ))}
    </div>
  );
}

/** Choose the period: a preset, or any two dates. Other filters on the page are kept. */
export function PeriodPicker({ path, period, keep = {} }: { path: string; period: Period; keep?: Record<string, string | undefined> }) {
  const extra = Object.entries(keep).filter(([, v]) => v) as [string, string][];
  const href = (p: string) => `${path}?${new URLSearchParams([["p", p], ...extra]).toString()}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PERIODS.map(([key, label]) => (
        <Link key={key} href={href(key)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            period.key === key ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
          }`}>
          {label}
        </Link>
      ))}
      <form action={path} className="flex items-center gap-1.5 text-xs">
        <input type="hidden" name="p" value="custom" />
        {extra.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="date" name="from" defaultValue={period.from > "2000-01-01" ? period.from : ""} aria-label="From"
          className="rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1" />
        <span className="text-[var(--muted)]">to</span>
        <input type="date" name="to" defaultValue={period.to < "2100-12-31" ? period.to : ""} aria-label="To"
          className="rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1" />
        <button type="submit" className={`rounded-full px-3 py-1 font-medium ${period.key === "custom" ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}>
          Go
        </button>
      </form>
    </div>
  );
}
