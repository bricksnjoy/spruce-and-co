"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * On a phone a list (a `table.cards`) shows each row as a card, and each value
 * needs its column's heading beside it. This copies the headings onto the
 * cells as data-label, where the stylesheet shows them; it runs again as rows
 * arrive or change.
 */
export function TableLabels() {
  const pathname = usePathname();
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const label = () => {
      for (const t of main.querySelectorAll<HTMLTableElement>("table.cards")) {
        const head = t.tHead?.rows[t.tHead.rows.length - 1];
        if (!head) continue;
        const names: string[] = [];
        for (const th of head.cells) for (let k = 0; k < th.colSpan; k++) names.push(th.textContent?.trim() ?? "");
        for (const body of [...t.tBodies, ...(t.tFoot ? [t.tFoot] : [])]) {
          for (const tr of body.rows) {
            let col = 0;
            for (const td of tr.cells) {
              // a cell across several columns (a total, an empty list) keeps no heading
              const name = td.colSpan > 1 ? "" : names[col] ?? "";
              if (name && td.dataset.label !== name) td.dataset.label = name;
              col += td.colSpan;
            }
          }
        }
      }
    };
    label();
    const watch = new MutationObserver(label);
    watch.observe(main, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [pathname]);
  return null;
}
