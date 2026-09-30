import { PageHeader } from "@/components/ui";
import { getSession } from "@/server/session";
import { redirect } from "next/navigation";
import { SettingsTabs, SharedNote } from "../tabs";
import { AccountingForm, type AccountingSettings } from "./accounting-form";
import { ResetTestBook } from "./reset-test-book";

export const dynamic = "force-dynamic";

export default async function AccountingSettingsPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data }, { data: company }] = await Promise.all([
    s.supabase.from("settings").select("*").eq("id", true).maybeSingle(),
    s.supabase.from("company").select("gst_registered").eq("id", true).maybeSingle(),
  ]);

  const settings: AccountingSettings = {
    closing_date: data?.closing_date ?? null,
    closing_date_set_at: data?.closing_date_set_at ?? null,
    opening_balance_date: data?.opening_balance_date ?? "2026-01-01",
    fiscal_year_start_month: data?.fiscal_year_start_month ?? 1,
    gst_period_months: data?.gst_period_months ?? 3,
    gst_due_day: data?.gst_due_day ?? 28,
    recognition_default: data?.recognition_default ?? "billing",
    profit_share_debit: data?.profit_share_debit ?? "expense",
    nopay_days_divisor: String(data?.nopay_days_divisor ?? "30"),
    approval_limit_bill: data?.approval_limit_bill == null ? "" : String(data.approval_limit_bill),
    gst_registered: company?.gst_registered ?? false,
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="How the books are kept" />
      <SettingsTabs active="/settings/accounting" />
      <SharedNote />
      <AccountingForm settings={settings} canEdit={s.role === "admin"} />
      {s.role === "admin" && <ResetTestBook inTest={s.book === "sandbox"} />}
    </div>
  );
}
