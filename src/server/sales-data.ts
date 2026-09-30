import type { Session } from "./session";
import { today } from "@/lib/format";

export type Option = { id: string; name: string };
export type CustomerOpt = Option & { terms_days: number | null; currency: string };
export type TaxCodeOpt = { id: string; code: string; name: string; rate: string };
export type AccountOpt = { id: string; code: string; name: string; currency?: string };
export type ProjectOpt = { id: string; code: string; name: string; customer_id: string | null };

/** What every sales form picks from, for the book you are in. */
export async function salesFormData(s: Session) {
  const [cust, proj, codes, income, banks, company] = await Promise.all([
    s.supabase.from("contacts").select("id, name, terms_days, currency").contains("kinds", ["customer"]).eq("active", true).order("name"),
    s.supabase.from("projects").select("id, code, name, customer_id").is("archived_at", null).order("code"),
    s.supabase.from("tax_codes").select("id, code, name, rate_code").eq("active", true).order("code"),
    s.supabase.from("accounts").select("id, code, name").eq("type", "income").eq("active", true).order("code"),
    s.supabase.from("accounts").select("id, code, name, currency").in("subtype", ["bank", "cash"]).eq("active", true).order("code"),
    s.supabase.from("company").select("gst_registered").eq("id", true).maybeSingle(),
  ]);
  // today's rate for each code, for the running total on screen (the database charges the rate on the document date)
  const t = today();
  const { data: rates } = await s.supabase.from("rates").select("code, value, effective_from").eq("kind", "gst").lte("effective_from", t).order("effective_from");
  const rateOf = new Map<string, string>();
  for (const r of rates ?? []) rateOf.set(r.code, String(r.value));
  const taxCodes: TaxCodeOpt[] = (codes.data ?? []).map((c) => ({ id: c.id, code: c.code, name: c.name, rate: c.rate_code ? rateOf.get(c.rate_code) ?? "0" : "0" }));
  const gstRegistered = Boolean(company.data?.gst_registered);
  return {
    customers: (cust.data ?? []) as CustomerOpt[],
    projects: (proj.data ?? []) as ProjectOpt[],
    taxCodes,
    defaultTaxCode: taxCodes.find((c) => c.code === (gstRegistered ? "STD" : "OOS"))?.id ?? null,
    incomeAccounts: (income.data ?? []) as AccountOpt[],
    banks: (banks.data ?? []) as AccountOpt[],
    gstRegistered,
  };
}
export type SalesFormData = Awaited<ReturnType<typeof salesFormData>>;
