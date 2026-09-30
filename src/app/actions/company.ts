"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CompanyResult = { error?: string; ok?: boolean };

export interface Company {
  legal_name: string;
  trade_name: string | null;
  registration_no: string | null;
  uei: string | null;
  tin: string | null;
  gst_registered: boolean;
  taxable_activity_no: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bank_details: string | null;
}

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};

export async function saveCompany(_prev: unknown, fd: FormData): Promise<CompanyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const legal_name = text(fd, "legal_name");
  if (!legal_name) return { error: "Enter the registered company name." };

  const { error } = await supabase
    .from("company")
    .update({
      legal_name,
      trade_name: text(fd, "trade_name"),
      registration_no: text(fd, "registration_no"),
      uei: text(fd, "uei"),
      tin: text(fd, "tin")?.replace(/\s+/g, "").toUpperCase() ?? null,
      gst_registered: fd.get("gst_registered") === "on",
      taxable_activity_no: text(fd, "taxable_activity_no")?.replace(/\s+/g, "").toUpperCase() ?? null,
      address: text(fd, "address"),
      phone: text(fd, "phone"),
      email: text(fd, "email"),
      bank_details: text(fd, "bank_details"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) return { error: error.message };
  // the new ledger's settings keep the same flag; only an admin may change them, so this is best-effort
  await supabase.from("settings").update({ gst_registered: fd.get("gst_registered") === "on" }).eq("id", true);

  revalidatePath("/settings/company");
  // the activity number rides on every new bill, and the GST sheet carries
  // the company header
  revalidatePath("/gst");
  revalidatePath("/projects", "layout");
  return { ok: true };
}
