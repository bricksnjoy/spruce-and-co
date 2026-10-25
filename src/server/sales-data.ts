import type { Session } from "./session";
import { today } from "@/lib/format";
import { signerFor, toTemplate, type SigningKit, type TemplateTail } from "@/lib/documents";
import { signingKit } from "@/lib/branding";
import type { Company } from "@/components/sales/ledger-sheet";
import type { SheetSigner } from "@/components/sales/sales-sheet";

export type Option = { id: string; name: string };
export type CustomerOpt = Option & {
  terms_days: number | null; currency: string;
  // what the document prints under "Bill to"
  company_name: string | null; address: string | null; tin: string | null; gst_registered: boolean | null; taxable_activity_no: string | null;
};
export type TaxCodeOpt = { id: string; code: string; name: string; rate: string };
export type AccountOpt = { id: string; code: string; name: string; currency?: string };
export type ProjectOpt = { id: string; code: string; name: string; customer_id: string | null };

/** What every sales form picks from, for the book you are in. */
export async function salesFormData(s: Session) {
  const [cust, proj, codes, income, banks, company] = await Promise.all([
    s.supabase.from("contacts").select("id, name, terms_days, currency, company_name, address, tin, gst_registered, taxable_activity_no").contains("kinds", ["customer"]).eq("active", true).order("name"),
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

/**
 * The company block and the signer a printed sales document carries: signed and
 * stamped as the default invoice template says (Quotations → Edit templates).
 */
/** `signer` is the invoice template's default; `kit` and `tail` let a document choose its own. */
export type SalesBranding = { company: Company | null; signer: SheetSigner | null; terms: string; footer: string; kit: SigningKit; tail: TemplateTail | null };
export async function salesBranding(s: Session): Promise<SalesBranding> {
  const [{ data: company }, { data: tpl }, kit] = await Promise.all([
    s.supabase.from("company").select("legal_name, trade_name, registration_no, tin, gst_registered, taxable_activity_no, address, phone, email, bank_details").eq("id", true).maybeSingle(),
    s.supabase.from("document_templates").select("*").eq("kind", "invoice").order("is_default", { ascending: false }).limit(1).maybeSingle(),
    signingKit(s.supabase),
  ]);
  const tail = tpl ? toTemplate(tpl).tail : null;
  return { company: (company as Company | null) ?? null, signer: tail ? signerFor(kit, tail, null, null) : null, terms: tail?.terms ?? "", footer: tail?.footer_text ?? "", kit, tail };
}
