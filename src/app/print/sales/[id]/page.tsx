import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { salesBranding } from "@/server/sales-data";
import { PrintToolbar } from "../../toolbar";
import { SalesSheet, sheetTitle } from "@/components/sales/sales-sheet";
import { dbToLaari, qtyTimesRate } from "@/lib/money";
import { signerFor } from "@/lib/documents";

export const dynamic = "force-dynamic";

const PRINTABLE = ["invoice", "credit_note", "sales_receipt"];

/** A tax invoice, credit note or sales receipt as the customer sees it (§8 tax-invoice details). */
export default async function PrintSalesDoc({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ data: doc }, { data: lines }, { company, signer: templateSigner, terms, footer, kit, tail }] = await Promise.all([
    s.supabase.from("sales_list_v").select("*").eq("id", id).maybeSingle(),
    s.supabase.from("transaction_lines").select("item_no, description, qty, unit, rate, amount, tax_amount, tax_code_id, tax_codes(code, name)").eq("transaction_id", id).order("line_no"),
    salesBranding(s),
  ]);
  if (!doc || !PRINTABLE.includes(doc.type) || !company) notFound();
  const [{ data: t }, { data: cust }] = await Promise.all([
    s.supabase.from("transactions").select("memo, reference, agr_no, po_no, signatory_id, show_stamp, currency").eq("id", id).maybeSingle(),
    s.supabase.from("contacts").select("name, company_name, address, tin, gst_registered, taxable_activity_no").eq("id", doc.contact_id).maybeSingle(),
  ]);
  const title = doc.number ?? sheetTitle(doc.type, company);
  // the invoice's own signer and stamp, else the template's
  const signer = tail ? signerFor(kit, tail, t?.signatory_id ?? null, t?.show_stamp ?? null) : templateSigner;

  return (
    <>
      <title>{title}</title>
      <PrintToolbar back={`/sales/${id}`} filename={title.replace(/[\\/]+/g, "-")} />
      <SalesSheet type={doc.type} company={company} number={doc.number} voided={Boolean(doc.voided_at)} customer={cust}
        date={doc.date} due={doc.due_date} projectCode={doc.project_code} reference={t?.reference ?? null} agrNo={t?.agr_no ?? null} poNo={t?.po_no ?? null}
        lines={(lines ?? []).map((l) => ({
          itemNo: l.item_no, description: l.description ?? "", unit: l.unit,
          heading: l.qty == null && dbToLaari(l.amount) === 0n && !l.tax_code_id,
          qty: l.qty == null ? null : Number(l.qty),
          rate: l.rate == null ? null : qtyTimesRate("1", String(l.rate)),
          amount: dbToLaari(l.amount),
          tax: dbToLaari(l.tax_amount),
          taxName: (l.tax_codes as unknown as { name: string } | null)?.name ?? "",
        }))}
        currency={t?.currency ?? "MVR"} paid={dbToLaari(doc.applied)} balance={dbToLaari(doc.balance)} memo={t?.memo ?? null} signer={signer} terms={terms} footer={footer} />
    </>
  );
}
