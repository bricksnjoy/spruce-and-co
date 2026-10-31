"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { toLaari } from "@/lib/money";

// an amount field, by its label: money words in, rates, percentages and counts out
const MONEY = /amount|value|total|salary|price|paid|mvr|balance|allowance|cost|gst|deposit|advance|received|credit|debit|limit|loan|fee|puts in|basic/i;
const NOT = /%|percent|rate|qty|quantity|days|fx|share|per unit|number|no\.|code/i;

const show = (v: bigint) => {
  const a = v < 0n ? -v : v;
  return `${v < 0n ? "-" : ""}${String(a / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(a % 100n).padStart(2, "0")}`;
};

function isAmount(el: Element): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement) || el.type !== "text" || el.inputMode !== "decimal" || el.dataset.plain !== undefined) return false;
  const name = [el.getAttribute("aria-label"), el.labels?.[0]?.textContent, el.name, el.id].filter(Boolean).join(" ");
  return MONEY.test(name) && !NOT.test(name);
}

/** Put the value back the way React's own typing would, so a controlled field keeps it. */
function write(el: HTMLInputElement) {
  const v = toLaari(el.value);
  if (v === null) return;
  const text = show(v);
  if (text === el.value) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Every amount field in the app reads 150,000.00: shown that way when a page
 * opens and once you leave the field (every form reads the commas back).
 */
export function AmountFormat() {
  const pathname = usePathname();
  useEffect(() => {
    const all = () => document.querySelectorAll("input").forEach((el) => { if (el !== document.activeElement && isAmount(el)) write(el); });
    const t = setTimeout(all, 50);
    const left = (e: FocusEvent) => { if (e.target instanceof Element && isAmount(e.target)) write(e.target); };
    document.addEventListener("focusout", left);
    return () => { clearTimeout(t); document.removeEventListener("focusout", left); };
  }, [pathname]);
  return null;
}
