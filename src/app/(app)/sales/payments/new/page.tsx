import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { salesFormData } from "@/server/sales-data";
import { openInvoices } from "@/server/open-invoices";
import { ApplyForm } from "@/components/sales/apply-form";
import { receivePayment } from "@/app/actions/sales";

export const dynamic = "force-dynamic";

export default async function ReceivePayment({ searchParams }: { searchParams: Promise<{ customer?: string; invoice?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!canWrite(s.role)) redirect("/sales");
  const [{ customer, invoice }, data, invoices] = await Promise.all([searchParams, salesFormData(s), openInvoices(s)]);
  return (
    <div className="max-w-5xl">
      <Link href="/sales" className="text-xs text-[var(--muted)] hover:underline">← Sales</Link>
      <PageHeader title="Receive payment" subtitle="Share one payment across a customer's invoices; anything not applied is held as their credit" />
      <ApplyForm mode="payment" action={receivePayment} customers={data.customers} invoices={invoices} banks={data.banks}
        initialCustomer={customer} initialInvoice={invoice} />
    </div>
  );
}
