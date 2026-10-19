import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { getSession } from "@/server/session";
import { date, money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";
import { NoPayrollAccess } from "@/components/payroll/no-access";
import { PayrollTabs } from "@/components/payroll/tabs";
import { NewRun } from "@/components/payroll/new-run";

export const dynamic = "force-dynamic";
const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v)));

export default async function PayrollPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.canPayroll) return <NoPayrollAccess />;
  const [{ data: runs }, { data: rate }] = await Promise.all([
    s.supabase.from("payroll_runs_v").select("id, period_month, pay_date, status, display_status, net_total, paid_total").order("period_month", { ascending: false }),
    s.supabase.from("rates").select("id").eq("kind", "wht").limit(1),
  ]);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Payroll" subtitle={`${bookLabel(s.book)} book · draft → review → approved (posted) → paid`} />
      <PayrollTabs active="/payroll" />
      {!rate?.length && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">Withholding-tax brackets are not set, so a run cannot be worked out. Add them in Settings → Taxes &amp; rates.</p>}
      <NewRun />
      <Card className="mt-5">
        {(runs ?? []).length === 0 ? <Empty message="No payroll runs yet." /> : (
          <Table>
            <thead><tr><Th>Month</Th><Th>Pay date</Th><Th right>Net pay</Th><Th right>Paid</Th><Th right>Status</Th></tr></thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-[var(--hover)]">
                  <Td><Link href={`/payroll/runs/${r.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                    {new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${r.period_month}T00:00:00Z`))}</Link></Td>
                  <Td>{date(r.pay_date)}</Td>
                  <Td right>{m(r.net_total)}</Td>
                  <Td right>{m(r.paid_total)}</Td>
                  <Td right><Badge value={r.display_status === "posted" ? "approved" : r.display_status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-[var(--muted)]"><Link href="/payroll/employees" className="hover:underline">Employees</Link> are paid in each run from their basic salary and standing allowances.</p>
    </div>
  );
}
