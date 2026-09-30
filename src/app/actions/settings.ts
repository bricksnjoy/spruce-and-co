"use server";

import { revalidatePath } from "next/cache";
import { dbMessage, getSession } from "@/server/session";
import { moneyToDb, percentToDb } from "@/lib/money";

export type Result = { error?: string; ok?: boolean };

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const isDate = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
const intIn = (v: string | null, lo: number, hi: number) => {
  if (v === null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
};

async function admin() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (s.role !== "admin") return { error: "Only an admin can change settings." } as const;
  return { s } as const;
}

/** Closing date, year, recognition, profit-share treatment, GST periods and payroll divisor. */
export async function saveAccountingSettings(_prev: unknown, fd: FormData): Promise<Result> {
  const a = await admin();
  if ("error" in a) return { error: a.error };

  const closing = text(fd, "closing_date");
  if (closing !== null && !isDate(closing)) return { error: "Enter the closing date as a date, or leave it blank." };
  const opening = text(fd, "opening_balance_date");
  if (!isDate(opening)) return { error: "Enter the opening balance date." };
  const fy = intIn(text(fd, "fiscal_year_start_month"), 1, 12);
  if (fy === null) return { error: "Choose the month the financial year starts." };
  const gstMonths = intIn(text(fd, "gst_period_months"), 1, 3);
  if (gstMonths !== 1 && gstMonths !== 3) return { error: "GST returns are monthly or quarterly." };
  const dueDay = intIn(text(fd, "gst_due_day"), 1, 28);
  if (dueDay === null) return { error: "The GST due day is between 1 and 28." };
  const recognition = text(fd, "recognition_default");
  if (recognition !== "billing" && recognition !== "poc") return { error: "Choose how project revenue is recognised." };
  const shareDebit = text(fd, "profit_share_debit");
  if (shareDebit !== "expense" && shareDebit !== "dividends") return { error: "Choose where profit shares are charged." };
  const divisor = text(fd, "nopay_days_divisor");
  if (divisor === null || !/^\d{1,3}(\.\d{1,2})?$/.test(divisor) || Number(divisor) <= 0) return { error: "Enter the no-pay day divisor (e.g. 30)." };
  const limitRaw = text(fd, "approval_limit_bill");
  const limit = limitRaw === null ? null : moneyToDb(limitRaw);
  if (limitRaw !== null && (limit === null || limit.startsWith("-"))) return { error: "Enter the bill approval limit as an amount, or leave it blank." };

  const { error } = await a.s.supabase.from("settings").update({
    closing_date: closing,
    opening_balance_date: opening,
    fiscal_year_start_month: fy,
    gst_period_months: gstMonths,
    gst_due_day: dueDay,
    recognition_default: recognition,
    profit_share_debit: shareDebit,
    nopay_days_divisor: divisor,
    approval_limit_bill: limit,
    updated_at: new Date().toISOString(),
  }).eq("id", true);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/settings/accounting");
  return { ok: true };
}

const RATE_KINDS = ["gst", "pension_employee", "pension_employer", "wht", "bpt"] as const;
type RateKind = (typeof RATE_KINDS)[number];
const BRACKETED: RateKind[] = ["wht", "bpt"];

/**
 * Add a rate from a date. Rates in force are never edited (the database
 * refuses); a change is a new rate from a later date.
 */
export async function addRate(_prev: unknown, fd: FormData): Promise<Result> {
  const a = await admin();
  if ("error" in a) return { error: a.error };
  const kind = text(fd, "kind") as RateKind | null;
  if (!kind || !RATE_KINDS.includes(kind)) return { error: "Unknown rate." };
  const code = text(fd, "code") ?? "default";
  const from = text(fd, "effective_from");
  if (!isDate(from)) return { error: "Enter the date the rate takes effect." };

  let row: { kind: string; code: string; effective_from: string; value?: string; brackets?: unknown };
  if (BRACKETED.includes(kind)) {
    // rows arrive as to_1, rate_1, to_2, rate_2 … ; each starts where the last ended
    const n = intIn(text(fd, "rows"), 1, 20);
    if (n === null) return { error: "Enter at least one bracket." };
    // kept as decimal strings in the JSON; the database reads them as exact numerics
    const brackets: { from: string; to: string | null; rate: string }[] = [];
    let start = "0.00";
    for (let i = 1; i <= n; i++) {
      const last = i === n;
      const to = last ? null : moneyToDb(text(fd, `to_${i}`));
      if (!last && (to === null || to.startsWith("-"))) return { error: `Enter where bracket ${i} ends.` };
      const rate = percentToDb(text(fd, `rate_${i}`));
      if (rate === null) return { error: `Enter bracket ${i}'s rate as a percentage.` };
      brackets.push({ from: start, to, rate });
      if (to !== null) start = to;
    }
    row = { kind, code, effective_from: from, brackets };
  } else {
    const value = percentToDb(text(fd, "value"));
    if (value === null) return { error: "Enter the rate as a percentage between 0 and 100." };
    row = { kind, code, effective_from: from, value };
  }
  const { error } = await a.s.supabase.from("rates").insert(row);
  if (error) {
    if (/duplicate key/.test(error.message)) return { error: "There is already a rate from that date." };
    return { error: dbMessage(error) };
  }
  revalidatePath("/settings/taxes");
  return { ok: true };
}

/** Remove a rate that has not taken effect yet. */
export async function deleteRate(id: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return { error: a.error };
  const { error } = await a.s.supabase.from("rates").delete().eq("id", id);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/settings/taxes");
  return { ok: true };
}

/** Change a document type's numbering in the book you are in. */
export async function saveNumbering(_prev: unknown, fd: FormData): Promise<Result> {
  const a = await admin();
  if ("error" in a) return { error: a.error };
  const type = text(fd, "type");
  const prefix = text(fd, "prefix");
  const next = intIn(text(fd, "next_number"), 1, 99_999_999);
  const pad = intIn(text(fd, "pad"), 1, 8);
  if (!type || !prefix) return { error: "Enter a prefix." };
  if (next === null) return { error: "The next number must be a whole number, 1 or more." };
  if (pad === null) return { error: "Digits must be between 1 and 8." };
  const { error } = await a.s.supabase.rpc("rpc_set_numbering", { p_type: type, p_prefix: prefix, p_next: next, p_pad: pad });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/settings/numbering");
  return { ok: true };
}

/** Add a currency, or switch one on or off. MVR is the home currency and always on. */
export async function saveCurrency(_prev: unknown, fd: FormData): Promise<Result> {
  const a = await admin();
  if ("error" in a) return { error: a.error };
  const code = text(fd, "code")?.toUpperCase() ?? null;
  const name = text(fd, "name");
  if (!code || !/^[A-Z]{3}$/.test(code)) return { error: "A currency code is three letters, e.g. EUR." };
  if (!name) return { error: "Enter the currency's name." };
  const { error } = await a.s.supabase.from("currencies").upsert({ code, name, active: true });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/settings/currencies");
  return { ok: true };
}

export async function setCurrencyActive(code: string, active: boolean): Promise<Result> {
  const a = await admin();
  if ("error" in a) return { error: a.error };
  if (code === "MVR") return { error: "MVR is the home currency and is always on." };
  const { error } = await a.s.supabase.from("currencies").update({ active }).eq("code", code);
  if (error) return { error: dbMessage(error) };
  revalidatePath("/settings/currencies");
  return { ok: true };
}

/** Record an exchange rate: how many MVR one unit buys on a day. */
export async function addExchangeRate(_prev: unknown, fd: FormData): Promise<Result> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  const currency = text(fd, "currency");
  const date = text(fd, "rate_date");
  const rate = text(fd, "rate");
  if (!currency || currency === "MVR") return { error: "Choose the currency." };
  if (!isDate(date)) return { error: "Enter the date." };
  if (rate === null || !/^\d{1,6}(\.\d{1,6})?$/.test(rate) || /^0+(\.0+)?$/.test(rate)) return { error: "Enter the rate: MVR for one unit, e.g. 15.42." };
  const { error } = await s.supabase.from("exchange_rates").upsert({ currency, rate_date: date, rate });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/settings/currencies");
  return { ok: true };
}
