import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { salesFormData } from "@/server/sales-data";
import { DocForm, TITLES, type DocType } from "@/components/sales/doc-form";

export const dynamic = "force-dynamic";
const s2 = (v: unknown) => (v == null ? "" : String(v));

export default async function EditSalesDoc({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (!canWrite(s.role)) redirect(`/sales/${id}`);
  const [{ data: t }, { data: lines }, data] = await Promise.all([
    s.supabase.from("transactions").select("*").eq("id", id).maybeSingle(),
    s.supabase.from("transaction_lines").select("*").eq("transaction_id", id).order("line_no"),
    salesFormData(s),
  ]);
  if (!t || !["invoice", "credit_note", "sales_receipt"].includes(t.type)) notFound();
  if (t.voided_at) redirect(`/sales/${id}`);
  return (
    <div className="max-w-6xl">
      <Link href={`/sales/${id}`} className="text-xs text-[var(--muted)] hover:underline">← {t.number ?? "Back"}</Link>
      <PageHeader title={`Edit ${TITLES[t.type as DocType].toLowerCase()} ${t.number ?? ""}`} subtitle="Saving posts the new figures in place of the old; the change is kept in the audit trail" />
      <DocForm data={data} values={{
        id, type: t.type, date: t.date, due_date: s2(t.due_date), contact_id: s2(t.contact_id), project_id: s2(t.project_id),
        currency: t.currency, fx_rate: s2(t.fx_rate), memo: s2(t.memo), reference: s2(t.reference), bank_account_id: s2(t.bank_account_id), is_draft: t.is_draft,
        lines: (lines ?? []).map((l) => ({ description: s2(l.description), qty: s2(l.qty), rate: s2(l.rate), amount: l.qty == null ? s2(l.amount) : "",
          tax_code_id: s2(l.tax_code_id), project_id: s2(l.project_id), account_id: s2(l.account_id) })),
      }} />
    </div>
  );
}
