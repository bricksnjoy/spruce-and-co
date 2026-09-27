"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavGroup, NavItem } from "@/lib/nav";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * A tick of feedback on the item just clicked. These pages are rendered on
 * demand, so there is a real wait before the next screen paints, and without
 * this the sidebar looks unresponsive for the whole of it.
 */
function Pending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-label="Loading"
      className="h-3 w-3 shrink-0 animate-spin rounded-full border border-current border-t-transparent opacity-60"
    />
  );
}

export function Sidebar({
  groups,
  quickActions,
}: {
  groups: NavGroup[];
  quickActions: NavItem[];
}) {
  const pathname = usePathname();

  // groups the user has opened or closed; any other group is open when the page is in it
  const [open, setOpen] = useState<Record<string, boolean>>({});


  return (
    <div className="flex flex-col gap-1 p-3">
      {quickActions.length > 0 && (
        <div className="mb-3 rounded-lg bg-[var(--brand-soft)] p-2">
          <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--brand)]">
            Quick actions
          </p>
          <div className="flex flex-col gap-1">
            {quickActions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="rounded-md bg-[var(--field)] px-2.5 py-1.5 text-xs font-medium text-[var(--brand)] transition-colors hover:bg-white"
              >
                + {a.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <nav className="flex flex-col gap-0.5">
        {groups.map((g) => {
          const hasActive = g.items.some((i) => isActive(pathname, i.href));
          const expanded = open[g.group] ?? (Boolean(g.defaultOpen) || hasActive);
          return (
            <div key={g.group}>
              <button
                type="button"
                onClick={() => setOpen((p) => ({ ...p, [g.group]: !expanded }))}
                aria-expanded={expanded}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                  hasActive ? "text-[var(--brand)]" : "text-[var(--muted)]"
                } hover:bg-[var(--brand-soft)]`}
              >
                {g.group}
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  aria-hidden="true"
                  className={`transition-transform ${expanded ? "rotate-90" : ""}`}
                >
                  <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>

              {expanded && (
                <ul className="mb-1 space-y-0.5 pl-1">
                  {g.items.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          prefetch
                          className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                            active
                              ? "bg-[var(--brand-soft)] font-medium text-[var(--brand)]"
                              : "text-[var(--muted)] hover:bg-[var(--brand-soft)] hover:text-[var(--text)]"
                          }`}
                        >
                          {item.label}
                          <Pending />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
