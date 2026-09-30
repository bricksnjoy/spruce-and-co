/** Date ranges for reports: presets and comparison periods (§11). Dates are ISO yyyy-mm-dd strings. */

export type Range = { from: string; to: string };
export const PRESETS = [
  ["this_month", "This month"], ["last_month", "Last month"],
  ["this_quarter", "This quarter"], ["last_quarter", "Last quarter"],
  ["this_year", "This financial year"], ["ytd", "Year to date"], ["last_year", "Last financial year"],
  ["custom", "Custom"],
] as const;
export type Preset = (typeof PRESETS)[number][0];
export type Compare = "none" | "prior_period" | "prior_year";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  // m is 1-based and may run past 12 or below 1
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const lastDay = (y: number, m: number) => iso(y, m + 1, 0);
export const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** The first day of the financial year containing `d`, when the year starts in month `fyStart`. */
export function fiscalYearStart(d: string, fyStart = 1): string {
  const [y, m] = parts(d);
  return iso(m < fyStart ? y - 1 : y, fyStart, 1);
}

/** The range a preset means on `today`. */
export function presetRange(p: Preset, today: string, fyStart = 1): Range {
  const [y, m] = parts(today);
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  const fy = fiscalYearStart(today, fyStart);
  const [fyY, fyM] = parts(fy);
  switch (p) {
    case "this_month": return { from: iso(y, m, 1), to: lastDay(y, m) };
    case "last_month": return { from: iso(y, m - 1, 1), to: lastDay(y, m - 1) };
    case "this_quarter": return { from: iso(y, q0, 1), to: lastDay(y, q0 + 2) };
    case "last_quarter": return { from: iso(y, q0 - 3, 1), to: lastDay(y, q0 - 1) };
    case "this_year": return { from: fy, to: lastDay(fyY, fyM + 11) };
    case "ytd": return { from: fy, to: today };
    case "last_year": return { from: iso(fyY - 1, fyM, 1), to: lastDay(fyY - 1, fyM + 11) };
    default: return { from: fy, to: today };
  }
}

/** Whole months from the first of `from`'s month to the end of `to`'s month, when the range is exactly whole months; else null. */
function wholeMonths(r: Range): number | null {
  const [fy, fm, fd] = parts(r.from);
  const [ty, tm] = parts(r.to);
  if (fd !== 1 || r.to !== lastDay(ty, tm)) return null;
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/** The period to compare with: the one just before (same length), or the same dates a year earlier. */
export function compareRange(r: Range, c: Compare): Range | null {
  if (c === "none") return null;
  const [fy, fm, fd] = parts(r.from);
  const [ty, tm, td] = parts(r.to);
  if (c === "prior_year") {
    const months = wholeMonths(r);
    if (months !== null) return { from: iso(fy - 1, fm, 1), to: lastDay(ty - 1, tm) };
    return { from: iso(fy - 1, fm, fd), to: iso(ty - 1, tm, td) };
  }
  const months = wholeMonths(r);
  if (months !== null) return { from: iso(fy, fm - months, 1), to: lastDay(fy, fm - 1) };
  const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
  return { from: iso(fy, fm, fd - days), to: iso(fy, fm, fd - 1) };
}

/** Read from/to/preset/compare from a query string, falling back to year to date. */
export function readRange(q: Record<string, string | undefined>, today: string, fyStart = 1) {
  const preset = (PRESETS.some(([k]) => k === q.preset) ? q.preset : isIsoDate(q.from) || isIsoDate(q.to) ? "custom" : "ytd") as Preset;
  let range = preset === "custom" ? { from: isIsoDate(q.from) ? q.from : fiscalYearStart(today, fyStart), to: isIsoDate(q.to) ? q.to : today } : presetRange(preset, today, fyStart);
  if (range.from > range.to) range = { from: range.to, to: range.from };
  const compare = (["prior_period", "prior_year"].includes(q.compare ?? "") ? q.compare : "none") as Compare;
  return { preset, range, compare, prior: compareRange(range, compare) };
}

/** Short label for a range: "Jan–Sep 2026", "Mar 2026", "1 Jan 2026 – 15 Feb 2026". */
export function rangeLabel(r: Range): string {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [fy, fm, fd] = parts(r.from);
  const [ty, tm, td] = parts(r.to);
  if (fd === 1 && r.to === lastDay(ty, tm)) {
    if (fy === ty && fm === tm) return `${M[fm - 1]} ${fy}`;
    return fy === ty ? `${M[fm - 1]}–${M[tm - 1]} ${fy}` : `${M[fm - 1]} ${fy} – ${M[tm - 1]} ${ty}`;
  }
  return `${fd} ${M[fm - 1]} ${fy} – ${td} ${M[tm - 1]} ${ty}`;
}
