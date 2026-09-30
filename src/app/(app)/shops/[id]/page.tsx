import { redirect } from "next/navigation";
import { getSession } from "@/server/session";

/** An old shop link opens the same vendor in the new list. */
export default async function ShopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const { data } = await s.supabase.from("contacts").select("id").eq("legacy->>vendor_id", id).maybeSingle();
  redirect(data ? `/expenses/vendors/${data.id}` : "/expenses/vendors");
}
