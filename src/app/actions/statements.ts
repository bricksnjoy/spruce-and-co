"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type StatementSettingsResult = { error?: string; ok?: boolean };

const num = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").replace(/,/g, "").trim();
  return v === "" ? 0 : Number(v);
};

/** The few figures the statements need that the rest of the app does not record. */
export async function saveStatementSettings(_prev: unknown, fd: FormData): Promise<StatementSettingsResult> {
  const supabase = await createClient();
  const share_capital = num(fd, "share_capital");
  const opening_cash = num(fd, "opening_cash");
  const bpt_rate = num(fd, "bpt_rate");
  const bpt_threshold = num(fd, "bpt_threshold");
  const asset_life_years = num(fd, "asset_life_years");
  const date = String(fd.get("share_capital_date") ?? "").trim();
  if ([share_capital, opening_cash, bpt_rate, bpt_threshold, asset_life_years].some((v) => !Number.isFinite(v))) return { error: "Enter numbers only." };
  if (share_capital < 0 || bpt_threshold < 0) return { error: "Amounts can't be negative." };
  if (bpt_rate < 0 || bpt_rate > 100) return { error: "The tax rate is a percentage between 0 and 100." };
  if (asset_life_years < 1 || asset_life_years > 50) return { error: "Equipment life is between 1 and 50 years." };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose the date the shares were paid for." };

  const { error, count } = await supabase
    .from("company")
    .update({ share_capital, share_capital_date: date || null, opening_cash, bpt_rate, bpt_threshold, asset_life_years, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", true);
  if (error) return { error: error.message };
  if (!count) return { error: "Only an admin can change these." };
  revalidatePath("/accounting", "layout");
  revalidatePath("/print/statements");
  return { ok: true };
}
