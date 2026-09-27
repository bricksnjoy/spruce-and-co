/**
 * Reads a bank statement exported as CSV (BML, MIB and most banks): finds the
 * header row, works out which columns hold the date, description, money in
 * and out and the balance, and returns one line per transaction, money in
 * positive and money out negative.
 */

export interface BankLine {
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  fingerprint: string;
}

export interface ParsedStatement {
  lines: BankLine[];
  columns: Record<string, string>;
  skipped: number;
}

/** Split CSV text into rows, honouring quotes. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  const sep = (t.split("\n", 1)[0].match(/;/g)?.length ?? 0) > (t.split("\n", 1)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** A date in any of the usual bank formats, as yyyy-mm-dd; day first where it is ambiguous. */
export function parseDate(v: string): string | null {
  const s = v.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i, "");
  let y: number, m: number, d: number;
  let r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3,4})[a-z]*[-/ .,]+(\d{2,4})$/))) [d, m, y] = [Number(r[1]), MONTHS[r[2].toLowerCase()] ?? 0, Number(r[3])];
  else if ((r = s.match(/^([A-Za-z]{3,4})[a-z]*[ .]+(\d{1,2}),?\s+(\d{4})$/))) [m, d, y] = [MONTHS[r[1].toLowerCase()] ?? 0, Number(r[2]), Number(r[3])];
  else return null;
  if (y < 100) y += 2000;
  if (!m || m > 12 || !d || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A money amount: commas, currency, brackets and DR/CR markers allowed. */
export function parseAmount(v: string): number | null {
  let s = v.trim();
  if (!s || s === "-") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bdr\.?$/i.test(s)) { sign = -1; s = s.replace(/\bdr\.?$/i, ""); }
  s = s.replace(/\bcr\.?$/i, "").replace(/[^0-9.-]/g, "");
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

const find = (header: string[], ...tests: RegExp[]) => {
  for (const t of tests) {
    const i = header.findIndex((h) => t.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

export function parseStatement(text: string): ParsedStatement {
  const rows = csvRows(text);
  const headerAt = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /amount|debit|credit|withdraw|deposit|balance/i.test(c)));
  if (headerAt < 0) throw new Error("Could not find the column headings. The file needs a row with Date and Amount (or Debit and Credit) columns.");
  const header = rows[headerAt].map((h) => h.toLowerCase());
  const col = {
    date: find(header, /^(transaction|txn|posting|book(ing)?)\s*date/, /^date$/, /date/),
    description: find(header, /desc/, /narration/, /details?/, /particular/, /remark/, /memo/, /reference/),
    debit: find(header, /debit/, /withdraw/, /money out/, /paid out/, /^dr$/),
    credit: find(header, /credit/, /deposit/, /money in/, /paid in/, /^cr$/),
    amount: find(header, /^amount/, /amount/),
    balance: find(header, /balance/),
  };
  if (col.date < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) throw new Error("Could not tell which columns hold the date and the amounts.");

  const lines: BankLine[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const date = parseDate(r[col.date] ?? "");
    let amount: number | null = null;
    if (col.debit >= 0 || col.credit >= 0) {
      const out = col.debit >= 0 ? parseAmount(r[col.debit] ?? "") : null;
      const inn = col.credit >= 0 ? parseAmount(r[col.credit] ?? "") : null;
      if (out || inn) amount = (inn ? Math.abs(inn) : 0) - (out ? Math.abs(out) : 0);
    }
    if (amount === null && col.amount >= 0) amount = parseAmount(r[col.amount] ?? "");
    if (!date || amount === null || amount === 0) { skipped++; continue; }
    const description = (col.description >= 0 ? r[col.description] : r.filter((_, i) => i !== col.date).join(" ")).slice(0, 300);
    const balance = col.balance >= 0 ? parseAmount(r[col.balance] ?? "") : null;
    const base = `${date}|${amount.toFixed(2)}|${balance === null ? "" : balance.toFixed(2)}|${description.toLowerCase().replace(/\s+/g, " ").slice(0, 80)}`;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    lines.push({ date, description, amount: Math.round(amount * 100) / 100, balance, fingerprint: k > 1 ? `${base}#${k}` : base });
  }
  const columns = Object.fromEntries(Object.entries(col).filter(([, i]) => i >= 0).map(([k, i]) => [k, rows[headerAt][i]]));
  return { lines, columns, skipped };
}
