/**
 * Money typed into a form, handled as whole laari so nothing is ever a float
 * (§1). The database stores numeric(18,2); amounts cross to it as strings.
 */

const MONEY = /^-?\d+(\.\d{1,2})?$/;

/** "1,250.5" → 125050n laari; null for blank or not a number. */
export function toLaari(input: string | null | undefined): bigint | null {
  const s = String(input ?? "").replace(/[,\s]/g, "").replace(/^MVR/i, "");
  if (s === "" || !MONEY.test(s)) return null;
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const v = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return neg ? -v : v;
}

/** 125050n → "1250.50", the form the database takes. */
export function laariToDb(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}

/** A typed amount straight to the database's form, or null. */
export function moneyToDb(input: string | null | undefined): string | null {
  const v = toLaari(input);
  return v === null ? null : laariToDb(v);
}

/** A percentage with up to 4 decimals (rates are numeric(9,4)), as a string; null if invalid. */
export function percentToDb(input: string | null | undefined): string | null {
  const s = String(input ?? "").replace(/[%\s]/g, "");
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  if (Number(w) > 100 || (Number(w) === 100 && /[1-9]/.test(f))) return null;
  return f ? `${w}.${f}` : w;
}

/**
 * An amount read back from the database (PostgREST sends numeric as a JSON
 * number or string) as whole laari, so totals are added exactly.
 */
export function dbToLaari(v: number | string | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "string") return toLaari(v) ?? 0n;
  return BigInt(Math.round(v * 100));
}

/** Whole laari back to rufiyaa for display only (money() formats it). */
export const laariToNumber = (v: bigint) => Number(v) / 100;

/** A running balance down a list of ledger lines, in laari; `sign` is 1 for debit-normal accounts, -1 otherwise. */
export function withRunning<T extends { home_debit: number | string; home_credit: number | string }>(lines: T[], sign: 1n | -1n) {
  let running = 0n;
  return lines.map((l) => {
    running += sign * (dbToLaari(l.home_debit) - dbToLaari(l.home_credit));
    return { ...l, running };
  });
}

/** `pct` per cent of an amount in laari, rounded half away from zero; pct is a decimal string (up to 4 places). */
export function percentOf(laari: bigint, pct: string | number): bigint {
  const s = String(pct);
  if (!/^-?\d+(\.\d{1,4})?$/.test(s)) return 0n;
  const [w, f = ""] = s.replace("-", "").split(".");
  const scaled = BigInt(w) * 10000n + BigInt((f + "0000").slice(0, 4));   // pct × 10⁴
  const num = laari * scaled * (s.startsWith("-") ? -1n : 1n);
  const den = 100n * 10000n;
  const q = num / den, r = num % den;
  const half = (r < 0n ? -r : r) * 2n >= den;
  return half ? q + (num < 0n ? -1n : 1n) : q;
}

/** Quantity × rate (each up to 4 decimals) in laari, rounded half away from zero, as the database does; null if not numbers. */
export function qtyTimesRate(qty: string, rate: string): bigint | null {
  const re = /^-?\d+(\.\d{1,4})?$/;
  if (!re.test(qty) || !re.test(rate)) return null;
  const scaled = (s: string) => {
    const [w, f = ""] = s.replace("-", "").split(".");
    return (BigInt(w) * 10000n + BigInt((f + "0000").slice(0, 4))) * (s.startsWith("-") ? -1n : 1n);
  };
  const num = scaled(qty) * scaled(rate);          // × 10⁸ rufiyaa
  const den = 1000000n;                             // → laari
  const q = num / den, r = num % den;
  return (r < 0n ? -r : r) * 2n >= den ? q + (num < 0n ? -1n : 1n) : q;
}
