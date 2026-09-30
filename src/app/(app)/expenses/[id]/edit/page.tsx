import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { expenseFormData } from "@/server/expense-data";
import { ExpenseForm, TITLES, type ExpenseType } from "@/components/expenses/expense-form";

export const dynamic = "force-dynamic";
const s2 = (v: unknown) => (v == null ? "" : String(v));

export default async function EditExpense({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (!canWrite(s.role)) redirect(`/expenses/${id}`);
  const [{ data: t }, { data: lines }, data] = await Promise.all([
    s.supabase.from("transactions").select("*").eq("id", id).maybeSingle(),
    s.supabase.from("transaction_lines").select("*").eq("transaction_id", id).order("line_no"),
    expenseFormData(s),
  ]);
  if (!t || !["bill", "expense", "vendor_credit", "purchase_order"].includes(t.type)) notFound();
  if (t.voided_at || t.closed_at) redirect(`/expenses/${id}`);
  return (
    <div className="max-w-7xl">
      <Link href={`/expenses/${id}`} className="text-xs text-[var(--muted)] hover:underline">← Back</Link>
      <PageHeader title={`Edit ${TITLES[t.type as ExpenseType].toLowerCase()} ${t.number ?? ""}`} subtitle="Saving posts the new figures in place of the old; the change is kept in the audit trail" />
      <ExpenseForm data={data} values={{
        id, type: t.type, date: t.date, due_date: s2(t.due_date), contact_id: s2(t.contact_id), project_id: s2(t.project_id), bank_account_id: s2(t.bank_account_id),
        currency: t.currency, fx_rate: s2(t.fx_rate), memo: s2(t.memo), reference: s2(t.reference), supplier_tin: s2(t.supplier_tin),
        tax_invoice_no: s2(t.tax_invoice_no), tax_invoice_date: s2(t.tax_invoice_date), customs_ref: s2(t.customs_ref), is_draft: t.is_draft,
        lines: (lines ?? []).map((l) => ({ description: s2(l.description), qty: s2(l.qty), rate: s2(l.rate), amount: l.qty == null ? s2(l.amount) : "",
          tax_amount: s2(l.tax_amount), gst_claimable: Boolean(l.gst_claimable), project_id: s2(l.project_id), account_id: s2(l.account_id) })),
      }} />
    </div>
  );
}
