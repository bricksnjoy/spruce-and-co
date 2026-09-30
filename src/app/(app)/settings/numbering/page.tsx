import { redirect } from "next/navigation";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { getSession } from "@/server/session";
import { bookLabel } from "@/lib/books";
import { SettingsTabs } from "../tabs";
import { NumberingRow } from "./numbering-row";

export const dynamic = "force-dynamic";

const NAMES: Record<string, string> = {
  estimate: "Estimates", invoice: "Invoices", credit_note: "Credit notes", sales_receipt: "Sales receipts",
  customer_payment: "Payments received", bill: "Bills", purchase_order: "Purchase orders", bill_payment: "Bill payments",
  journal: "Journal entries", payout: "Payouts", payroll_run: "Payroll runs", distribution: "Profit distributions",
};

export default async function NumberingPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  // the policy shows both books' sequences; this page is about the book you are in
  const { data } = await s.supabase.from("document_sequences").select("type, prefix, next_number, pad").eq("book", s.book).order("type");
  const rows = (data ?? []).sort((a, b) => Object.keys(NAMES).indexOf(a.type) - Object.keys(NAMES).indexOf(b.type));

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" subtitle="How each document is numbered" />
      <SettingsTabs active="/settings/numbering" />
      <p className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--hover)] px-4 py-2.5 text-xs text-[var(--muted)]">
        Numbering for the <strong>{bookLabel(s.book)}</strong> book. Each book numbers on its own{s.book === "sandbox" ? ", and Test numbers always start with TEST-" : ""}.
        {" "}<code className="font-mono">{"{YY}"}</code> becomes the year of the document date.
      </p>
      <Card>
        <CardHeader title="Document numbers" subtitle={s.role === "admin" ? "The next document of each kind takes the number shown" : "Only an admin can change these"} />
        <div className="divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <NumberingRow key={r.type} type={r.type} name={NAMES[r.type] ?? r.type} prefix={r.prefix}
              next={r.next_number} pad={r.pad} canEdit={s.role === "admin"} />
          ))}
        </div>
      </Card>
    </div>
  );
}
