import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { expenseFormData } from "@/server/expense-data";
import { PayBillsForm, type OpenBill } from "@/components/expenses/pay-bills";

export const dynamic = "force-dynamic";

export default async function PayBills({ searchParams }: { searchParams: Promise<{ bill?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!canWrite(s.role)) redirect("/expenses");
  const [{ bill }, data, { data: bills }] = await Promise.all([
    searchParams, expenseFormData(s),
    s.supabase.from("expenses_list_v").select("id, number, date, due_date, balance, vendor_name, contact_id, project_code, tax_invoice_no, licence_expiry, insurance_expiry, status")
      .eq("type", "bill").in("status", ["open", "partial", "overdue"]).order("due_date").order("date"),
  ]);
  return (
    <div className="max-w-6xl">
      <Link href="/expenses" className="text-xs text-[var(--muted)] hover:underline">← Expenses</Link>
      <PageHeader title="Pay bills" subtitle="Tick the bills to pay; one payment is made per vendor" />
      <PayBillsForm bills={(bills ?? []) as OpenBill[]} payFrom={data.payFrom} preselect={bill} />
    </div>
  );
}
