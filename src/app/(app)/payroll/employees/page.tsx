import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { getSession } from "@/server/session";
import { date, money, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { NoPayrollAccess } from "@/components/payroll/no-access";
import { PayrollTabs } from "@/components/payroll/tabs";
import { NewEmployee } from "@/components/payroll/employee-form";

export const dynamic = "force-dynamic";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.canPayroll) return <NoPayrollAccess />;
  const all = (await searchParams).all === "1";
  let q = s.supabase.from("employees").select("id, name, job_title, department, nationality_type, basic_salary, permit_expiry, needs_review, active").order("name");
  if (!all) q = q.eq("active", true);
  const { data } = await q;
  const t = today();
  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <PageHeader title="Payroll" subtitle="Everyone paid through payroll, directors included" />
        <PayrollTabs active="/payroll/employees" />
      </div>
      <NewEmployee />
      <Card>
        {(data ?? []).length === 0 ? <Empty message="No employees yet." /> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Role</Th><Th>Where</Th><Th right>Basic salary</Th><Th right>Work permit</Th></tr></thead>
            <tbody>
              {(data ?? []).map((e) => (
                <tr key={e.id} className={`hover:bg-[var(--hover)] ${e.active ? "" : "text-[var(--muted)]"}`}>
                  <Td>
                    <Link href={`/payroll/employees/${e.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">{e.name}</Link>
                    {e.needs_review && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Needs details</span>}
                    {!e.active && <span className="ml-2 text-xs">(left)</span>}
                  </Td>
                  <Td>{e.job_title ?? "—"}</Td>
                  <Td>{e.department === "site" ? "Site" : "Admin"} · {e.nationality_type === "maldivian" ? "Maldivian" : "Expatriate"}</Td>
                  <Td right>{money(laariToNumber(dbToLaari(e.basic_salary)))}</Td>
                  <Td right className={e.permit_expiry && e.permit_expiry < t ? "text-red-700" : ""}>{e.permit_expiry ? date(e.permit_expiry) : ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Link href={all ? "/payroll/employees" : "/payroll/employees?all=1"} className="text-xs text-[var(--muted)] hover:underline">{all ? "Hide people who have left" : "Show people who have left"}</Link>
    </div>
  );
}
