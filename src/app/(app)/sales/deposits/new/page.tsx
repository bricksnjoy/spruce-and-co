import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { salesFormData } from "@/server/sales-data";
import { DepositForm, type Receipt } from "@/components/sales/deposit-form";

export const dynamic = "force-dynamic";

export default async function NewDeposit() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!canWrite(s.role)) redirect("/sales");
  // receipts that went to Undeposited Funds (no bank chosen) and are not yet banked
  const [{ data }, form] = await Promise.all([
    s.supabase.from("sales_list_v").select("id, type, number, date, total, customer_name, voided_at, is_draft, deposited_in")
      .in("type", ["customer_payment", "sales_receipt"]).is("deposited_in", null).is("voided_at", null).eq("is_draft", false).order("date"),
    salesFormData(s),
  ]);
  const ids = (data ?? []).map((r) => r.id);
  const { data: banked } = ids.length ? await s.supabase.from("transactions").select("id").in("id", ids).not("bank_account_id", "is", null) : { data: [] };
  const direct = new Set((banked ?? []).map((r) => r.id));
  const receipts = ((data ?? []) as Receipt[]).filter((r) => !direct.has(r.id));
  return (
    <div className="max-w-4xl">
      <Link href="/sales" className="text-xs text-[var(--muted)] hover:underline">← Sales</Link>
      <PageHeader title="Bank deposit" subtitle="Move receipts from Undeposited Funds into the bank, the way the bank shows them" />
      <DepositForm receipts={receipts} banks={form.banks} />
    </div>
  );
}
