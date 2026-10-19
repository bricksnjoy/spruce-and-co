import { redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { ContactDetail } from "@/components/contacts/contact-detail";
import { VENDORS } from "@/components/contacts/sides";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ id }, { tab, from, to }] = await Promise.all([params, searchParams]);
  return <ContactDetail s={s} side={VENDORS} id={id} tab={tab} from={from} to={to} />;
}
