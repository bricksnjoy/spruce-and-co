import Link from "next/link";

const TABS: [string, string][] = [
  ["/settings/company", "Company"],
  ["/settings/accounting", "Accounting"],
  ["/settings/taxes", "Taxes & rates"],
  ["/settings/numbering", "Numbering"],
  ["/settings/currencies", "Currencies"],
];

/** The settings pages, as tabs. */
export function SettingsTabs({ active }: { active: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--border)]">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
            active === href ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
          }`}>
          {label}
        </Link>
      ))}
    </div>
  );
}

/** Settings are shared by the Live and Test books. */
export function SharedNote() {
  return (
    <p className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--hover)] px-4 py-2.5 text-xs text-[var(--muted)]">
      These settings are shared by the Live and Test books; a change here applies to both.
    </p>
  );
}
