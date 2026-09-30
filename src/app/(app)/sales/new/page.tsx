import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { salesFormData } from "@/server/sales-data";
import { DocForm, blankDoc, TITLES, type DocType } from "@/components/sales/doc-form";

export const dynamic = "force-dynamic";

export default async function NewSalesDoc({ searchParams }: { searchParams: Promise<{ type?: string; customer?: string; project?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!canWrite(s.role)) redirect("/sales");
  const { type, customer, project } = await searchParams;
  const t: DocType = type === "credit_note" || type === "sales_receipt" ? type : "invoice";
  const data = await salesFormData(s);
  const proj = data.projects.find((p) => p.id === project);
  return (
    <div className="max-w-6xl">
      <Link href="/sales" className="text-xs text-[var(--muted)] hover:underline">← Sales</Link>
      <PageHeader title={`New ${TITLES[t].toLowerCase()}`}
        subtitle={t === "credit_note" ? "Reduces what a customer owes; apply it to their invoices when receiving payment" : t === "sales_receipt" ? "A sale paid on the spot" : "Posted when you save; the number is given then"} />
      <DocForm data={data} values={blankDoc(t, data, customer ?? proj?.customer_id ?? "", proj?.id ?? "")} />
    </div>
  );
}
