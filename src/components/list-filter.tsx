"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** A search box and one filter for a list, kept in the address (?q=…&show=…) so a refresh keeps them. */
export function ListFilter({ base, show, q, options, placeholder = "Search" }: {
  base: string; show: string; q: string; options: [string, string][]; placeholder?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const go = (next: { show?: string; q?: string }) => {
    const p = new URLSearchParams();
    const sh = next.show ?? show, qq = (next.q ?? text).trim();
    if (sh && sh !== "all") p.set("show", sh);
    if (qq) p.set("q", qq);
    router.push(`${base}${p.size ? `?${p}` : ""}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form className="relative min-w-0 flex-1 sm:max-w-sm" onSubmit={(e) => { e.preventDefault(); go({}); }}>
        <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== q && go({})}
          placeholder={placeholder} aria-label={placeholder}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--field)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--brand)]" />
      </form>
      <select aria-label="Filter" value={show} onChange={(e) => go({ show: e.target.value })}
        className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]">
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </div>
  );
}
