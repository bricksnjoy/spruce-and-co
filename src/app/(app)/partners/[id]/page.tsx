import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { Partner } from "./partner";

export const dynamic = "force-dynamic";

/** A partner's or lender's page; the body is in ./partner. */
export default async function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <Partner s={s} id={id} />;
}
