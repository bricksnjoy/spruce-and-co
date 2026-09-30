import type { Session } from "./session";
import { today } from "@/lib/format";

export type VendorOpt = {
  id: string; name: string; tin: string | null; gst_registered: boolean; terms_days: number | null; currency: string;
  licence_expiry: string | null; insurance_expiry: string | null; vendor_kind: string | null;
};
export type AccountOpt = { id: string; code: string; name: string; type: string; budget_category: string | null };

/** What every purchase form picks from, for the book you are in. */
export async function expenseFormData(s: Session) {
  const t = today();
  const [ven, proj, accts, money, rate] = await Promise.all([
    s.supabase.from("contacts").select("id, name, tin, gst_registered, terms_days, currency, licence_expiry, insurance_expiry, vendor_kind")
      .contains("kinds", ["vendor"]).eq("active", true).order("name"),
    s.supabase.from("projects").select("id, code, name").is("archived_at", null).order("code"),
    s.supabase.from("accounts").select("id, code, name, type, subtype, budget_category").eq("active", true).is("contact_id", null).order("code"),
    s.supabase.from("accounts").select("id, code, name, subtype").in("subtype", ["bank", "cash", "credit_card"]).eq("active", true).order("code"),
    s.supabase.from("rates").select("value").eq("kind", "gst").eq("code", "STD").lte("effective_from", t).order("effective_from", { ascending: false }).limit(1),
  ]);
  // what a purchase can be for: job costs, overheads, and assets bought
  const purchasable = (accts.data ?? []).filter((a) => a.type === "cogs" || a.type === "expense" || (a.type === "asset" && ["fixed_asset", "prepayments"].includes(a.subtype ?? "")));
  return {
    vendors: (ven.data ?? []) as VendorOpt[],
    projects: (proj.data ?? []) as { id: string; code: string; name: string }[],
    accounts: purchasable as AccountOpt[],
    payFrom: (money.data ?? []) as { id: string; code: string; name: string }[],
    gstRate: String(rate.data?.[0]?.value ?? "8"),
  };
}
export type ExpenseFormData = Awaited<ReturnType<typeof expenseFormData>>;
