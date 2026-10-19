/**
 * The 12-week cash-flow forecast (feature: cash-flow forecast). Expected
 * receipts and payments are placed in the week they fall due; anything
 * already overdue, or owed now with no date, lands in the first week.
 */
export type Flow = { date: string | null; amount: bigint; kind: string; label?: string };
export type Week = { start: string; end: string; cashIn: bigint; cashOut: bigint; net: bigint; closing: bigint; byKind: Record<string, bigint> };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Monday on or before a date. */
export function weekStart(d: string) {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(d, -((day + 6) % 7));
}

export function forecast(today: string, cash: bigint, receipts: Flow[], payments: Flow[], weeks = 12): Week[] {
  const first = weekStart(today);
  const out: Week[] = Array.from({ length: weeks }, (_, i) => ({
    start: addDays(first, i * 7), end: addDays(first, i * 7 + 6), cashIn: 0n, cashOut: 0n, net: 0n, closing: 0n, byKind: {},
  }));
  const slot = (d: string | null) => {
    if (!d || d <= out[0].end) return 0;
    const i = Math.floor((Date.parse(d) - Date.parse(first)) / (7 * 86400000));
    return i < weeks ? i : -1;
  };
  for (const r of receipts) { const i = slot(r.date); if (i >= 0 && r.amount > 0n) { out[i].cashIn += r.amount; out[i].byKind[r.kind] = (out[i].byKind[r.kind] ?? 0n) + r.amount; } }
  for (const p of payments) { const i = slot(p.date); if (i >= 0 && p.amount > 0n) { out[i].cashOut += p.amount; out[i].byKind[p.kind] = (out[i].byKind[p.kind] ?? 0n) - p.amount; } }
  let run = cash;
  for (const w of out) { w.net = w.cashIn - w.cashOut; run += w.net; w.closing = run; }
  return out;
}

/** Payroll repeated monthly on the given day (clamped to month end) for the months the forecast covers. */
export function monthlyOn(today: string, day: number, amount: bigint, kind: string, months = 4): Flow[] {
  const [y, m] = today.split("-").map(Number);
  const flows: Flow[] = [];
  for (let i = 0; i < months; i++) {
    const last = new Date(Date.UTC(y, m - 1 + i + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(y, m - 1 + i, Math.min(day, last))).toISOString().slice(0, 10);
    if (d >= today) flows.push({ date: d, amount, kind });
  }
  return flows;
}
