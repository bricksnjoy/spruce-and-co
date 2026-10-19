import { redirect } from "next/navigation";
import { getSession } from "@/server/session";

/** An old person link opens the same employee. */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  const { data } = await s.supabase.from("employees").select("id").eq("legacy_person_id", id).maybeSingle();
  redirect(data ? `/payroll/employees/${data.id}` : "/payroll/employees");
}
