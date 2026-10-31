"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// the phone's bottom bar: label and a line icon for each page it can hold
const TABS: Record<string, { label: string; icon: string }> = {
  "/": { label: "Home", icon: "M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z" },
  "/projects": { label: "Projects", icon: "M3 6.5h14v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM7 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" },
  "/tasks": { label: "Tasks", icon: "M4 4.5h12a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1zM3 8h14M7 3v3M13 3v3" },
  "/bids": { label: "Bids", icon: "M6 3h6l4 4v9.5a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5V3.5A.5.5 0 0 1 6 3zM12 3v4h4M8 11h6M8 14h4" },
  "/sales": { label: "Sales", icon: "M4 15.5 8 11l3 3 5-6.5M12.5 7.5H16V11" },
};

/**
 * The sidebar is hidden on narrow screens; this puts it behind a menu button
 * so every page can still be reached from a phone, with the pages used most
 * and the menu again in a bar along the bottom, as phone apps have them.
 */
export function MobileNav({ children, tabs = [] }: { children: ReactNode; tabs?: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [shownFor, setShownFor] = useState(pathname);

  // close once the next page has loaded
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
        className="-ml-2 rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] md:hidden">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
        {tabs.map((href) => {
          const t = TABS[href];
          const on = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${on ? "text-[var(--brand)]" : "text-[var(--muted)]"}`}>
              <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
              {t.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-[var(--muted)]">
          <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
          Menu
        </button>
      </nav>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] shadow-xl">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"
              className="absolute right-3 top-5 z-10 rounded-md p-1 text-[var(--muted)] hover:text-[var(--text)]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
            {children}
          </aside>
        </div>
      )}
    </>
  );
}
