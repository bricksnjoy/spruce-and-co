import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { salesFormData } from "@/server/sales-data";
import { invoiceFromQuotation } from "@/server/quotation-invoices";
import { DocForm } from "@/components/sales/doc-form";
import { blankDoc, TITLES, type DocType } from "@/lib/sales-doc";

export const dynamic = "force-dynamic";

export default async function NewSalesDoc({ searchParams }: { searchParams: Promise<{ type?: string; customer?: string; project?: string; quotation?: string; pct?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!canWrite(s.role)) redirect("/sales");
  const { type, customer, project, quotation, pct } = await searchParams;
  const t: DocType = type === "credit_note" || type === "sales_receipt" ? type : "invoice";
  const data = await salesFormData(s);
  const proj = data.projects.find((p) => p.id === project);
  // quotations are Live-only, so one is invoiced only from the Live book
  const fromQuote = quotation && t === "invoice" && s.book === "live" ? await invoiceFromQuotation(s, data, quotation, pct ?? "") : null;
  const values = fromQuote && "values" in fromQuote ? fromQuote.values : blankDoc(t, data, customer ?? proj?.customer_id ?? "", proj?.id ?? "");
  return (
    <div className="max-w-6xl">
      {fromQuote && "quotation" in fromQuote
        ? <Link href={`/quotations/${fromQuote.quotation.id}`} className="text-xs text-[var(--muted)] hover:underline">← {fromQuote.quotation.number}</Link>
        : <Link href="/sales" className="text-xs text-[var(--muted)] hover:underline">← Sales</Link>}
      <PageHeader title={`New ${TITLES[t].toLowerCase()}`}
        subtitle={fromQuote && "quotation" in fromQuote ? `From quotation ${fromQuote.quotation.number}: check the lines, then save to post it`
          : t === "credit_note" ? "Reduces what a customer owes; apply it to their invoices when receiving payment" : t === "sales_receipt" ? "A sale paid on the spot" : "Posted when you save; the number is given then"} />
      {fromQuote && "error" in fromQuote && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fromQuote.error}</p>}
      <DocForm data={data} values={values} />
    </div>
  );
}
