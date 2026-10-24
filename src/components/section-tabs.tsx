"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { placeOf, type NavGroup } from "@/lib/nav";
import { Pending } from "@/components/pending";

/**
 * The other pages of the menu item this page is under, as tabs along the top:
 * Sales shows Sales & invoices · Customers · Quotations, and so on. Only the
 * tabs this person can see in this book are passed in.
 */
export function SectionTabs({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const place = placeOf(groups, pathname);
  const tabs = place?.item.tabs ?? [];
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={place!.item.label} className="-mt-1 mb-4 flex gap-1 overflow-x-auto border-b border-[var(--border)] print:hidden">
      {tabs.map((t) => {
        const on = t === place!.tab;
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
            className={`-mb-px flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
              on ? "border-[var(--brand)] font-medium text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
            }`}>
            {t.label}
            <Pending />
          </Link>
        );
      })}
    </nav>
  );
}
