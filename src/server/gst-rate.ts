import type { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/format";

/** The standard GST rate in force today (Settings → Taxes), as a decimal string; 8 until one is set. */
export async function standardGstRate(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("rates").select("value").eq("kind", "gst").eq("code", "STD")
    .lte("effective_from", today()).order("effective_from", { ascending: false }).limit(1);
  return String(data?.[0]?.value ?? "8");
}
