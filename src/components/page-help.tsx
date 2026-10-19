"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { helpFor } from "@/lib/help";

/** "How to use this page", folded away at the top of every page. */
export function PageHelp() {
  const pathname = usePathname();
  const h = helpFor(pathname);
  if (!h) return null;
  return (
    <details className="group mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm print:hidden">
      <summary className="cursor-pointer select-none px-4 py-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)]">
        How to use this page
      </summary>
      <div className="space-y-2 border-t border-[var(--border)] px-4 py-3">
        <p>{h.purpose}</p>
        <ol className="list-decimal space-y-1 pl-5">{h.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {h.tips?.map((t, i) => <p key={i} className="text-xs text-[var(--muted)]">Tip: {t}</p>)}
        <p className="text-xs"><Link href="/help" className="text-[var(--brand)] hover:underline">All pages →</Link></p>
      </div>
    </details>
  );
}
