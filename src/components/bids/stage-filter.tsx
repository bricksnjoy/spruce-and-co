"use client";

import { useRouter } from "next/navigation";

/** One drop-down for the bids list: open bids, one stage, or all; kept in the address (?status=…). */
export function StageFilter({ value, options }: { value: string; options: [string, string][] }) {
  const router = useRouter();
  return (
    <select aria-label="Show" value={value} onChange={(e) => router.push(e.target.value === "open" ? "/bids" : `/bids?status=${e.target.value}`)}
      className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]">
      {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}
