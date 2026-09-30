import Link from "next/link";
import type { Cell, Col, Report, Row } from "@/lib/report-model";
import { date, money } from "@/lib/format";
import { laariToNumber } from "@/lib/money";

/** One cell as text: money in rufiyaa (negatives in brackets), % to one decimal, dates as dates. */
export function cellText(c: Col, v: Cell): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "bigint") {
    if (v === 0n) return "–";
    const s = money(laariToNumber(v < 0n ? -v : v));
    return v < 0n ? `(${s})` : s;
  }
  if (c.kind === "pct") return typeof v === "number" ? `${v.toFixed(1)}%` : String(v);
  if (c.kind === "date") return date(String(v));
  return String(v);
}

const rowClass = (r: Row) =>
  r.style === "section" ? "bg-[var(--hover)] font-semibold"
  : r.style === "total" ? "border-t-2 border-[var(--text)] font-semibold"
  : r.style === "subtotal" ? "border-t border-[var(--border)] font-medium"
  : r.style === "muted" ? "text-[var(--muted)]" : "";

/** The report as a table; row labels and figures link to what makes them up. */
export function ReportTable({ report, print = false }: { report: Report; print?: boolean }) {
  const cols = report.columns;
  const link = (href: string | undefined, text: string, className = "") =>
    href && !print ? <Link href={href} className={`hover:underline ${className}`}>{text}</Link> : text;
  return (
    <div className={print ? "" : "overflow-x-auto"}>
      <table className={`w-full ${print ? "text-[9.5px]" : "text-sm"}`}>
        <thead>
          <tr className={print ? "" : "border-b border-[var(--border)]"}>
            {cols.map((c, i) => (
              <th key={c.key} className={`whitespace-nowrap px-3 py-2 text-xs font-medium ${print ? "bg-[#0b1f3a] text-white" : "text-[var(--muted)]"} ${c.kind && c.kind !== "text" && c.kind !== "date" ? "text-right" : "text-left"} ${i === 0 ? "min-w-[12rem]" : ""}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r, i) => (
            <tr key={i} className={`${rowClass(r)} ${print ? "" : "border-b border-[var(--border)] last:border-0"}`}>
              {cols.map((c, j) => {
                const v = r.cells[c.key] ?? null;
                const t = cellText(c, v);
                const right = c.kind && c.kind !== "text" && c.kind !== "date";
                const neg = typeof v === "bigint" && v < 0n;
                return (
                  <td key={c.key} className={`px-3 py-1.5 ${right ? "whitespace-nowrap text-right tabular-nums" : ""} ${j === 0 && r.style === "indent" ? "pl-7" : ""} ${neg ? "text-red-700" : ""}`}>
                    {j === 0 || (j === 1 && c.key === "label") ? link(r.href, t, r.style === "section" ? "" : "text-[var(--brand)]")
                      : r.hrefs?.[c.key] && typeof v === "bigint" && v !== 0n ? link(r.hrefs[c.key], t) : t}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {report.rows.length === 0 && <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">Nothing to show for this period.</p>}
      {(report.notes ?? []).length > 0 && (
        <div className={`space-y-1 px-3 py-3 ${print ? "text-[9px]" : "text-xs"} text-[var(--muted)]`}>
          {report.notes!.map((n, i) => <p key={i}>{n}</p>)}
        </div>
      )}
    </div>
  );
}
