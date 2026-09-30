/**
 * Money is always shown to the laari. Rounding to whole rufiyaa on screen
 * made a 5.56 GST line read as 6, which does not reconcile against the bill
 * in the photo beside it.
 */
export const money = (n: number | null | undefined, currency = "MVR") => {
  // anything that rounds to zero is plain zero, never "-0.00"
  const v = Math.round(Number(n ?? 0) * 100) / 100 || 0;
  return new Intl.NumberFormat("en-MV", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
};

/** Kept as its own name for the places that always meant the exact figure. */
export const moneyExact = money;

export const pct = (n: number | null | undefined, digits = 1) =>
  `${Number(n ?? 0).toFixed(digits)}%`;

/** Dates and times are shown in Maldives time, whether rendered on the server (UTC) or in the browser. */
export const TZ = "Indian/Maldives";

export const date = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: TZ }).format(new Date(d)) : "—";

export const dateTime = (d: string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(d))
    : "—";

export const num = (n: unknown) => Number(n ?? 0);

/**
 * Today's date (YYYY-MM-DD) in the Maldives. The server runs on UTC, so
 * taking the date from toISOString() gave yesterday until 5am here.
 */
export const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

export function titleize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** A YYYY-MM-DD date moved by a number of days. */
export function addDays(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
