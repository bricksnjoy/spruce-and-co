"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The round initials in the header: pressing it shows who is signed in, their role and Sign out. */
export function ProfileMenu({ initials, name, email, role, signOut }: {
  initials: string; name: string; email: string | null; role: ReactNode;
  signOut: () => Promise<void>;
}) {
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
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Your profile" aria-expanded={open} aria-haspopup="menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)] ring-[var(--brand)] transition hover:ring-2 focus-visible:ring-2">
        {initials}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand)]">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              {email && <p className="truncate text-xs text-[var(--muted)]">{email}</p>}
              <div className="mt-1">{role}</div>
            </div>
          </div>
          <form action={signOut} className="border-t border-[var(--border)] p-1.5">
            <button type="submit" role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
