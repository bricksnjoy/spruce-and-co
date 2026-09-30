import { redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { ContactList } from "@/components/contacts/contact-list";
import { VENDORS } from "@/components/contacts/sides";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { view, q } = await searchParams;
  return <ContactList s={s} side={VENDORS} view={view} query={q?.trim() ?? ""} />;
}
