"use client";

import { useState } from "react";
import { input } from "@/components/form-styles";
import { addDays, daysBetween } from "@/lib/format";

/**
 * A due date typed either as a number of days from the document date or as
 * the date itself; each fills in the other.
 */
export function DueIn({ id, label, from, value, onChange, name }: {
  id: string; label: string; from: string; value: string; onChange: (date: string) => void; name?: string;
}) {
  // what is typed in the days box while it has focus; otherwise it follows the dates
  const [typed, setTyped] = useState<string | null>(null);
  const days = typed ?? (from && value ? String(daysBetween(from, value)) : "");
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <input id={`${id}-days`} type="number" min="0" inputMode="numeric" aria-label={`${label} in days`} value={days}
          onChange={(e) => {
            setTyped(e.target.value);
            const n = parseInt(e.target.value, 10);
            if (from && Number.isFinite(n) && n >= 0) onChange(addDays(from, n));
          }}
          onBlur={() => setTyped(null)} className={`${input} w-20 tabular-nums`} />
        <span className="shrink-0 text-xs text-[var(--muted)]">days</span>
        <input id={id} name={name} type="date" value={value} onChange={(e) => { setTyped(null); onChange(e.target.value); }} className={input} />
      </div>
    </div>
  );
}
