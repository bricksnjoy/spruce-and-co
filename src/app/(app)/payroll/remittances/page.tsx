import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getSession } from "@/server/session";
import { money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { NoPayrollAccess } from "@/components/payroll/no-access";
import { PayrollTabs } from "@/components/payroll/tabs";
import { RemitForm } from "@/components/payroll/remit-form";

export const dynamic = "force-dynamic";

/** What is held back from pay (pension, withholding tax, other deductions) and paying it over. */
export default async function Remittances() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.canPayroll) return <NoPayrollAccess />;
  const [{ data: accts }, { data: bals }, { data: banks }] = await Promise.all([
    s.supabase.from("accounts").select("id, code, name, subtype").in("subtype", ["pension_payable", "wht_payable", "other_deductions_payable"]).order("code"),
    s.supabase.rpc("rpc_account_balances", {}),
    s.supabase.from("accounts").select("id, code, name").in("subtype", ["bank", "cash"]).eq("active", true).order("code"),
  ]);
  const bal = new Map(((bals ?? []) as { account_id: string; balance: number }[]).map((b) => [b.account_id, dbToLaari(b.balance)]));
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <PageHeader title="Payroll" subtitle="Held back from pay until paid over to the pension office or MIRA" />
        <PayrollTabs active="/payroll/remittances" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {(accts ?? []).map((a) => (
          <Card key={a.id} className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{a.name}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{money(laariToNumber(bal.get(a.id) ?? 0n))}</p>
          </Card>
        ))}
      </div>
      <RemitForm accounts={(accts ?? []).map((a) => ({ id: a.id, name: a.name, owed: String(laariToNumber(bal.get(a.id) ?? 0n)) }))} banks={banks ?? []} />
    </div>
  );
}
