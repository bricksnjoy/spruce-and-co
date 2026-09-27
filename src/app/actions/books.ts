"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BankLine } from "@/lib/bank-csv";

export type BooksResult = { error?: string; ok?: boolean; done?: number; id?: string };

const refresh = () => {
  revalidatePath("/accounting", "layout");
  revalidatePath("/print/statements");
};
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const amount = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").replace(/,/g, "").trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
/** Errors from the closed-year guard read well as they are; others get a prefix. */
const say = (e: { message: string }) => e.message;

async function me() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// ── bank ─────────────────────────────────────────────────────────────

export async function importBankStatement(meta: { fileName: string; account: string; closing: number | null }, lines: BankLine[]): Promise<BooksResult> {
  const { supabase, user } = await me();
  if (!user) return { error: "Not signed in." };
  if (!lines.length) return { error: "No transactions found in the file." };
  const dates = lines.map((l) => l.date).sort();
  const { data: st, error } = await supabase
    .from("bank_statements")
    .insert({ file_name: meta.fileName.slice(0, 200), account: meta.account.trim() || null, period_from: dates[0], period_to: dates[dates.length - 1], closing_balance: meta.closing })
    .select("id")
    .single();
  if (error) return { error: say(error) };
  const rows = lines.map((l) => ({ statement_id: st.id, line_date: l.date, description: l.description, amount: l.amount, balance: l.balance, fingerprint: l.fingerprint }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error: e } = await supabase.from("bank_lines").upsert(rows.slice(i, i + 500), { onConflict: "fingerprint", ignoreDuplicates: true }).select("id");
    if (e) return { error: say(e) };
    added += data?.length ?? 0;
  }
  if (!added) await supabase.from("bank_statements").delete().eq("id", st.id);
  refresh();
  return { ok: true, done: added };
}

export async function deleteBankStatement(id: string): Promise<BooksResult> {
  const { supabase } = await me();
  const { error } = await supabase.from("bank_statements").delete().eq("id", id);
  if (error) return { error: say(error) };
  refresh();
  return { ok: true };
}

/** Match bank lines to book entries, explain them, or open them again. */
export async function markBankLines(changes: { id: string; status: "open" | "matched" | "explained"; ref?: string | null; note?: string | null }[]): Promise<BooksResult> {
  const { supabase, user } = await me();
  if (!user) return { error: "Not signed in." };
  for (const c of changes) {
    if (c.status === "explained" && !c.note?.trim()) return { error: "Say what the payment was for." };
    if (c.status === "matched" && !c.ref) return { error: "Choose what it matches in the books." };
  }
  const now = new Date().toISOString();
  for (let i = 0; i < changes.length; i += 20) {
    const res = await Promise.all(
      changes.slice(i, i + 20).map((c) =>
        supabase
          .from("bank_lines")
          .update({
            status: c.status,
            match_ref: c.status === "matched" ? c.ref : null,
            note: c.status === "open" ? null : c.note?.trim() || null,
            marked_by: c.status === "open" ? null : user.id,
            marked_at: c.status === "open" ? null : now,
          })
          .eq("id", c.id),
      ),
    );
    const bad = res.find((r) => r.error);
    if (bad?.error) return { error: say(bad.error) };
  }
  refresh();
  return { ok: true, done: changes.length };
}

// ── tax ──────────────────────────────────────────────────────────────

export async function addTaxPayment(_prev: unknown, fd: FormData): Promise<BooksResult> {
  const { supabase, user } = await me();
  if (!user) return { error: "Not signed in." };
  const paid_on = text(fd, "paid_on");
  const kind = text(fd, "kind");
  const value = amount(fd, "amount");
  if (!isDate(paid_on)) return { error: "Choose the date it was paid." };
  if (!kind || !["bpt", "gst", "other"].includes(kind)) return { error: "Choose which tax." };
  if (!value || Number.isNaN(value) || value <= 0) return { error: "Enter the amount paid." };
  const { data, error } = await supabase
    .from("tax_payments")
    .insert({ paid_on, kind, amount: value, period: text(fd, "period"), reference: text(fd, "reference"), note: text(fd, "note") })
    .select("id")
    .single();
  if (error) return { error: say(error) };
  // recorded from a bank line: match it straight away
  const line = text(fd, "bank_line_id");
  if (line) await supabase.from("bank_lines").update({ status: "matched", match_ref: `tax:${data.id}|${paid_on}`, marked_by: user.id, marked_at: new Date().toISOString() }).eq("id", line);
  refresh();
  return { ok: true, id: data.id };
}

export async function deleteTaxPayment(id: string): Promise<BooksResult> {
  const { supabase } = await me();
  const { error, count } = await supabase.from("tax_payments").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: say(error) };
  if (!count) return { error: "Only an admin can delete a tax payment." };
  await supabase.from("bank_lines").update({ status: "open", match_ref: null }).like("match_ref", `tax:${id}|%`);
  refresh();
  return { ok: true };
}

export interface Adjustment {
  label: string;
  kind: "add" | "less";
  amount: number;
}

/** Save the year's business profit tax worksheet; the tax is worked out again here from what was sent. */
export async function saveTaxReturn(input: {
  year: number;
  pbt: number;
  adjustments: Adjustment[];
  lossBroughtForward: number;
  filedOn: string | null;
  reference: string | null;
  note: string | null;
}): Promise<BooksResult> {
  const { supabase, user } = await me();
  if (!user) return { error: "Not signed in." };
  if (!Number.isInteger(input.year)) return { error: "Choose the year." };
  if (input.filedOn && !isDate(input.filedOn)) return { error: "Choose the date it was filed." };
  const adjustments = input.adjustments
    .filter((a) => a.label.trim() && Number.isFinite(a.amount) && a.amount !== 0)
    .map((a) => ({ label: a.label.trim().slice(0, 120), kind: a.kind === "less" ? "less" : "add", amount: Math.abs(a.amount) }));
  const { data: company } = await supabase.from("company").select("bpt_rate, bpt_threshold").eq("id", true).maybeSingle();
  const taxable = input.pbt + adjustments.reduce((s, a) => s + (a.kind === "add" ? a.amount : -a.amount), 0) - Math.max(0, input.lossBroughtForward);
  const tax = Math.round((Math.max(0, taxable - Number(company?.bpt_threshold ?? 500000)) * Number(company?.bpt_rate ?? 15)) / 100 * 100) / 100;
  const { error } = await supabase.from("tax_returns").upsert({
    year: input.year,
    adjustments,
    loss_brought_forward: Math.max(0, input.lossBroughtForward),
    tax,
    filed_on: input.filedOn || null,
    reference: input.reference?.trim() || null,
    note: input.note?.trim() || null,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: say(error) };
  refresh();
  return { ok: true };
}

export async function deleteTaxReturn(year: number): Promise<BooksResult> {
  const { supabase } = await me();
  const { error, count } = await supabase.from("tax_returns").delete({ count: "exact" }).eq("year", year);
  if (error) return { error: say(error) };
  if (!count) return { error: "Only an admin can remove a tax worksheet." };
  refresh();
  return { ok: true };
}

// ── equipment ────────────────────────────────────────────────────────

export async function saveAsset(_prev: unknown, fd: FormData): Promise<BooksResult> {
  const { supabase, user } = await me();
  if (!user) return { error: "Not signed in." };
  const id = text(fd, "id");
  const name = text(fd, "name");
  const purchased_on = text(fd, "purchased_on");
  const cost = amount(fd, "cost");
  const life = amount(fd, "life_years");
  const disposed_on = text(fd, "disposed_on");
  const disposal_amount = amount(fd, "disposal_amount");
  if (!name) return { error: "Name the item." };
  if (!isDate(purchased_on)) return { error: "Choose the date it was bought." };
  if (cost === null || Number.isNaN(cost) || cost < 0) return { error: "Enter what it cost." };
  if (!life || Number.isNaN(life) || life <= 0 || life > 50) return { error: "Its useful life is between 1 and 50 years." };
  if (disposed_on && !isDate(disposed_on)) return { error: "Choose the date it was sold or scrapped." };
  if (disposed_on && disposed_on < purchased_on!) return { error: "It can't be sold before it was bought." };
  if (disposal_amount !== null && (Number.isNaN(disposal_amount) || disposal_amount < 0)) return { error: "Enter what it was sold for, or 0 if scrapped." };
  const row = {
    name,
    category: text(fd, "category"),
    purchased_on,
    cost,
    life_years: life,
    bill_id: text(fd, "bill_id"),
    disposed_on: disposed_on || null,
    disposal_amount: disposed_on ? disposal_amount ?? 0 : null,
    serial_no: text(fd, "serial_no"),
    location: text(fd, "location"),
    note: text(fd, "note"),
    updated_at: new Date().toISOString(),
  };
  const { error } = id ? await supabase.from("assets").update(row).eq("id", id) : await supabase.from("assets").insert(row);
  if (error) return { error: error.code === "23505" ? "That bill is already in the register." : say(error) };
  refresh();
  return { ok: true };
}

export async function deleteAsset(id: string): Promise<BooksResult> {
  const { supabase } = await me();
  const { error, count } = await supabase.from("assets").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: say(error) };
  if (!count) return { error: "Only an admin can delete from the register." };
  refresh();
  return { ok: true };
}

// ── year end ─────────────────────────────────────────────────────────

export async function saveFinancialYear(_prev: unknown, fd: FormData): Promise<BooksResult> {
  const { supabase, user } = await me();
  if (!user) return { error: "Not signed in." };
  const year = Number(fd.get("year"));
  if (!Number.isInteger(year)) return { error: "Choose the year." };
  const approved_on = text(fd, "approved_on");
  if (approved_on && !isDate(approved_on)) return { error: "Choose the date the Board approved them." };
  const { error } = await supabase.from("financial_years").upsert({
    year,
    principal_activity: text(fd, "principal_activity"),
    directors: text(fd, "directors"),
    report_note: text(fd, "report_note"),
    approved_on,
    signatory_id: text(fd, "signatory_id"),
    show_stamp: fd.get("show_stamp") === "on",
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: say(error) };
  refresh();
  return { ok: true };
}

/** Close a year's books, keeping the headline figures as they stood. */
export async function closeYear(year: number, snapshot: Record<string, number>): Promise<BooksResult> {
  const { supabase, user } = await me();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("financial_years")
    .upsert({ year, closed_at: new Date().toISOString(), closed_by: user.id, snapshot, updated_at: new Date().toISOString() });
  if (error) return { error: say(error) };
  refresh();
  return { ok: true };
}

export async function reopenYear(year: number): Promise<BooksResult> {
  const { supabase, user } = await me();
  if (!user) return { error: "Not signed in." };
  const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (p?.role !== "admin") return { error: "Only an admin can reopen a closed year." };
  const { error } = await supabase.from("financial_years").update({ closed_at: null, closed_by: null, updated_at: new Date().toISOString() }).eq("year", year);
  if (error) return { error: say(error) };
  refresh();
  return { ok: true };
}
