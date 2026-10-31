"use client";

import type { InputHTMLAttributes } from "react";
import { toLaari } from "@/lib/money";

const show = (v: bigint) => `${v < 0n ? "-" : ""}${(v < 0n ? -v : v) / 100n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + `.${String((v < 0n ? -v : v) % 100n).padStart(2, "0")}`;

/** An amount field that shows what was typed as 150,000.00 once you leave it (the commas are read back fine). */
export function MoneyInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input inputMode="decimal" {...props}
      onBlur={(e) => { const v = toLaari(e.currentTarget.value); if (v !== null) e.currentTarget.value = show(v); props.onBlur?.(e); }} />
  );
}
