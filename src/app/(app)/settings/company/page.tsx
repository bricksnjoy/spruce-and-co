import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import type { Company } from "@/app/actions/company";
import { CompanyForm } from "./company-form";
import { SettingsTabs } from "../tabs";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("company").select("*").eq("id", true).maybeSingle();

  const company: Company = {
    legal_name: data?.legal_name ?? "",
    trade_name: data?.trade_name ?? null,
    registration_no: data?.registration_no ?? null,
    uei: data?.uei ?? null,
    tin: data?.tin ?? null,
    gst_registered: data?.gst_registered ?? false,
    taxable_activity_no: data?.taxable_activity_no ?? null,
    address: data?.address ?? null,
    phone: data?.phone ?? null,
    email: data?.email ?? null,
    bank_details: data?.bank_details ?? null,
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Details every filing and invoice repeats" />
      <SettingsTabs active="/settings/company" />
      <CompanyForm company={company} />
    </div>
  );
}
