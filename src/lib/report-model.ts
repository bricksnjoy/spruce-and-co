/**
 * The shape every report takes, and the pure steps that turn trial-balance
 * rows into statements. Amounts are whole laari (bigint) end to end; the
 * screen, CSV, workbook and print view all read the same Report.
 */
import { dbToLaari } from "./money";

export type Cell = string | bigint | number | null;
export type Col = { key: string; label: string; kind?: "money" | "text" | "pct" | "date" | "num" };
export type Row = {
  cells: Record<string, Cell>;
  /** where the row's label goes (drill-down) */
  href?: string;
  /** per-column drill-down */
  hrefs?: Record<string, string>;
  style?: "section" | "subtotal" | "total" | "indent" | "muted";
};
export type Report = { title: string; subtitle?: string; columns: Col[]; rows: Row[]; notes?: string[] };

export type TbRow = {
  account_id: string; code: string; name: string; type: "asset" | "liability" | "equity" | "income" | "cogs" | "expense";
  subtype: string | null; parent_id: string | null; opening: number | string; debit: number | string; credit: number | string; closing: number | string;
};
/** A TB row in laari, with a per-person sub-account folded into its parent. */
export type Acct = { id: string; code: string; name: string; type: TbRow["type"]; subtype: string | null; opening: bigint; debit: bigint; credit: bigint; closing: bigint };

export function rollup(rows: TbRow[], parents: Map<string, { code: string; name: string }> = new Map()): Acct[] {
  const out = new Map<string, Acct>();
  for (const r of rows) {
    const id = r.parent_id && parents.has(r.parent_id) ? r.parent_id : r.account_id;
    const p = r.parent_id ? parents.get(r.parent_id) : undefined;
    const a = out.get(id) ?? { id, code: p?.code ?? r.code, name: p?.name ?? r.name, type: r.type, subtype: r.subtype, opening: 0n, debit: 0n, credit: 0n, closing: 0n };
    a.opening += dbToLaari(r.opening); a.debit += dbToLaari(r.debit); a.credit += dbToLaari(r.credit); a.closing += dbToLaari(r.closing);
    out.set(id, a);
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Movement in the range, debit positive. */
export const movement = (a: Acct) => a.debit - a.credit;

/** % of `part` in `whole`, to one decimal, or null. */
export function pctOf(part: bigint, whole: bigint): number | null {
  if (whole === 0n) return null;
  return Number((part * 10000n) / whole) / 100;
}

type Series = { key: string; label: string; accts: Acct[] };

/**
 * Statement of profit or loss with one money column per series (periods or
 * projects) and, for a single series, % of revenue. Income shows as positive,
 * costs as positive, profit = income − costs.
 */
export function profitLoss(series: Series[], link?: (accountId: string, seriesKey: string) => string): Row[] {
  const rows: Row[] = [];
  const ids = new Map<string, Acct>();
  for (const s of series) for (const a of s.accts) if (["income", "cogs", "expense"].includes(a.type) && movement(a) !== 0n) ids.set(a.id, a);
  const val = (s: Series, id: string) => { const a = s.accts.find((x) => x.id === id); return a ? movement(a) : 0n; };
  const income = (s: Series) => s.accts.filter((a) => a.type === "income").reduce((t, a) => t - movement(a), 0n);
  const total = (s: Series, type: string) => s.accts.filter((a) => a.type === type).reduce((t, a) => t + movement(a), 0n);
  const single = series.length === 1;
  const withPct = (cells: Record<string, Cell>, s: Series, v: bigint) => { if (single) cells.pct = pctOf(v, income(s)); return cells; };
  const section = (type: "income" | "cogs" | "expense", title: string, totalLabel: string) => {
    const list = [...ids.values()].filter((a) => a.type === type).sort((a, b) => a.code.localeCompare(b.code));
    rows.push({ cells: { label: title }, style: "section" });
    for (const a of list) {
      const cells: Record<string, Cell> = { label: `${a.code} ${a.name}` };
      const hrefs: Record<string, string> = {};
      for (const s of series) {
        const v = type === "income" ? -val(s, a.id) : val(s, a.id);
        cells[s.key] = v;
        if (link) hrefs[s.key] = link(a.id, s.key);
      }
      rows.push({ cells: withPct(cells, series[0], cells[series[0].key] as bigint), hrefs, style: "indent" });
    }
    const cells: Record<string, Cell> = { label: totalLabel };
    for (const s of series) cells[s.key] = type === "income" ? income(s) : total(s, type);
    rows.push({ cells: withPct(cells, series[0], cells[series[0].key] as bigint), style: "subtotal" });
  };
  section("income", "Revenue", "Total revenue");
  section("cogs", "Cost of sales", "Total cost of sales");
  const gross: Record<string, Cell> = { label: "Gross profit" };
  for (const s of series) gross[s.key] = income(s) - total(s, "cogs");
  rows.push({ cells: withPct(gross, series[0], gross[series[0].key] as bigint), style: "total" });
  section("expense", "Expenses", "Total expenses");
  const net: Record<string, Cell> = { label: "Profit for the period" };
  for (const s of series) net[s.key] = income(s) - total(s, "cogs") - total(s, "expense");
  rows.push({ cells: withPct(net, series[0], net[series[0].key] as bigint), style: "total" });
  return rows;
}

/** Net profit of a set of accounts over the range (credit positive). */
export const profitOf = (accts: Acct[]) => accts.filter((a) => ["income", "cogs", "expense"].includes(a.type)).reduce((t, a) => t - movement(a), 0n);

const NON_CURRENT_ASSETS = ["fixed_asset", "accumulated_depreciation"];

/**
 * Statement of financial position as at the end of each series' range. Each
 * series is a trial balance from the start of its financial year, so
 * `opening` of P&L accounts is profit brought forward and the movement is this
 * year's profit.
 */
export function balanceSheet(series: Series[], link?: (accountId: string, seriesKey: string) => string): Row[] {
  const rows: Row[] = [];
  const bal = (s: Series, id: string) => s.accts.find((a) => a.id === id)?.closing ?? 0n;
  const all = new Map<string, Acct>();
  for (const s of series) for (const a of s.accts) if (["asset", "liability", "equity"].includes(a.type) && a.closing !== 0n) all.set(a.id, a);
  const group = (title: string, pick: (a: Acct) => boolean, sign: 1n | -1n, totalLabel: string) => {
    const list = [...all.values()].filter(pick).sort((a, b) => a.code.localeCompare(b.code));
    if (list.length) rows.push({ cells: { label: title }, style: "section" });
    for (const a of list) {
      const cells: Record<string, Cell> = { label: `${a.code} ${a.name}` };
      const hrefs: Record<string, string> = {};
      for (const s of series) { cells[s.key] = bal(s, a.id) * sign; if (link) hrefs[s.key] = link(a.id, s.key); }
      rows.push({ cells, hrefs, style: "indent" });
    }
    const cells: Record<string, Cell> = { label: totalLabel };
    for (const s of series) cells[s.key] = s.accts.filter(pick).reduce((t, a) => t + a.closing * sign, 0n);
    rows.push({ cells, style: "subtotal" });
    return cells;
  };
  group("Non-current assets", (a) => a.type === "asset" && NON_CURRENT_ASSETS.includes(a.subtype ?? ""), 1n, "Total non-current assets");
  group("Current assets", (a) => a.type === "asset" && !NON_CURRENT_ASSETS.includes(a.subtype ?? ""), 1n, "Total current assets");
  const ta: Record<string, Cell> = { label: "Total assets" };
  for (const s of series) ta[s.key] = s.accts.filter((a) => a.type === "asset").reduce((t, a) => t + a.closing, 0n);
  rows.push({ cells: ta, style: "total" });
  group("Liabilities", (a) => a.type === "liability", -1n, "Total liabilities");

  rows.push({ cells: { label: "Equity" }, style: "section" });
  const eqLine = (label: string, f: (s: Series) => bigint) => {
    const cells: Record<string, Cell> = { label };
    for (const s of series) cells[s.key] = f(s);
    if (series.some((s) => cells[s.key] !== 0n)) rows.push({ cells, style: "indent" });
  };
  const eq = (s: Series, st: string | null, part: "closing" | "opening" | "move") => s.accts
    .filter((a) => a.type === "equity" && (st === null ? !["share_capital", "retained_earnings", "dividends"].includes(a.subtype ?? "") : a.subtype === st))
    .reduce((t, a) => t - (part === "closing" ? a.closing : part === "opening" ? a.opening : movement(a)), 0n);
  const plBroughtForward = (s: Series) => s.accts.filter((a) => ["income", "cogs", "expense"].includes(a.type)).reduce((t, a) => t - a.opening, 0n);
  eqLine("Share capital", (s) => eq(s, "share_capital", "closing"));
  eqLine("Retained earnings brought forward", (s) => eq(s, "retained_earnings", "closing") + eq(s, "dividends", "opening") + plBroughtForward(s));
  eqLine("Profit for the year to date", (s) => profitOf(s.accts));
  eqLine("Dividends this year", (s) => eq(s, "dividends", "move"));
  eqLine("Other equity", (s) => eq(s, null, "closing"));
  const te: Record<string, Cell> = { label: "Total equity" };
  for (const s of series) te[s.key] = s.accts.filter((a) => ["equity", "income", "cogs", "expense"].includes(a.type)).reduce((t, a) => t - a.closing, 0n);
  rows.push({ cells: te, style: "subtotal" });
  const tle: Record<string, Cell> = { label: "Total liabilities and equity" };
  for (const s of series) tle[s.key] = -s.accts.filter((a) => a.type !== "asset").reduce((t, a) => t + a.closing, 0n);
  rows.push({ cells: tle, style: "total" });
  return rows;
}

/** CSV text for a report (money in rufiyaa with 2 decimals). */
export function reportCsv(r: Report): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const fmt = (c: Col, v: Cell) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "bigint") { const neg = v < 0n; const a = neg ? -v : v; return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`; }
    if (c.kind === "pct" && typeof v === "number") return v.toFixed(1);
    return String(v);
  };
  const lines = [r.columns.map((c) => q(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => q(fmt(c, row.cells[c.key] ?? null))).join(","));
  return lines.join("\n") + "\n";
}
