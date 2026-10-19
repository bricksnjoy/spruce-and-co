import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { expenseFormData } from "@/server/expense-data";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { blankExpense, TITLES, type ExpenseType } from "@/lib/expense-doc";

export const dynamic = "force-dynamic";
const SUB: Record<ExpenseType, string> = {
  bill: "What a supplier has billed you, to pay later",
  expense: "Paid on the spot, by bank, cash or card",
  vendor_credit: "A supplier's credit, reducing what you owe them",
  purchase_order: "An order to a supplier; it counts as committed cost on the project until billed",
};

export default async function NewExpense({ searchParams }: { searchParams: Promise<{ type?: string; vendor?: string; project?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!canWrite(s.role)) redirect("/expenses");
  const { type, vendor, project } = await searchParams;
  const t: ExpenseType = type === "expense" || type === "vendor_credit" || type === "purchase_order" ? type : "bill";
  const data = await expenseFormData(s);
  return (
    <div className="max-w-7xl">
      <Link href="/expenses" className="text-xs text-[var(--muted)] hover:underline">← Expenses</Link>
      <PageHeader title={`New ${TITLES[t].toLowerCase()}`} subtitle={SUB[t]} />
      <ExpenseForm data={data} values={blankExpense(t, vendor ?? "", project ?? "", data)} />
    </div>
  );
}
