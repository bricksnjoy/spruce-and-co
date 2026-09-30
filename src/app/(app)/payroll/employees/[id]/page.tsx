import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { getSession } from "@/server/session";
import { date, money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { NoPayrollAccess } from "@/components/payroll/no-access";
import { EmployeeForm, type Employee } from "@/components/payroll/employee-form";
import { StandingItems, Allocations, AdvanceForm } from "@/components/payroll/employee-parts";

export const dynamic = "force-dynamic";
const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v)));

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.canPayroll) return <NoPayrollAccess />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: e } = await s.supabase.from("employees").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();
  const [{ data: items }, { data: standing }, { data: allocs }, { data: projects }, { data: slips }, { data: adv }, { data: recov }, { data: banks }] = await Promise.all([
    s.supabase.from("pay_items").select("id, code, name, kind, calc").eq("active", true).eq("calc", "fixed").neq("code", "BASIC").order("sort_order"),
    s.supabase.from("employee_pay_items").select("pay_item_id, amount").eq("employee_id", id),
    s.supabase.from("employee_allocations").select("project_id, percent, effective_from, projects(code)").eq("employee_id", id).order("effective_from", { ascending: false }),
    s.supabase.from("projects").select("id, code, name").is("archived_at", null).order("code"),
    s.supabase.from("payslips").select("id, gross, net, payroll_runs(id, period_month, status)").eq("employee_id", id),
    s.supabase.from("journal_lines").select("home_debit, home_credit, date, transaction_id").eq("employee_id", id).eq("account_id",
      (await s.supabase.from("accounts").select("id").eq("subtype", "staff_advances").maybeSingle()).data?.id ?? "00000000-0000-0000-0000-000000000000"),
    s.supabase.from("advance_recoveries").select("instalment, start_month, active").eq("employee_id", id),
    s.supabase.from("accounts").select("id, code, name").in("subtype", ["bank", "cash"]).eq("active", true).order("code"),
  ]);
  const owed = (adv ?? []).reduce((a, l) => a + dbToLaari(l.home_debit) - dbToLaari(l.home_credit), 0n);
  const latest = (allocs ?? []).filter((a) => a.effective_from === (allocs ?? [])[0]?.effective_from);
  type Run = { id: string; period_month: string; status: string };

  return (
    <div className="max-w-5xl space-y-5">
      <Link href="/payroll/employees" className="text-xs text-[var(--muted)] hover:underline">← Employees</Link>
      <PageHeader title={e.name} subtitle={[e.job_title, e.department === "site" ? "Site" : "Admin"].filter(Boolean).join(" · ")} />
      {e.needs_review && <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">Copied from the old People list: salary, nationality and bank details were never recorded. Check them and save.</p>}
      <Card><CardHeader title="Details" /><div className="px-5 py-5"><EmployeeForm e={{ ...(e as unknown as Employee), basic_salary: String(e.basic_salary) }} /></div></Card>
      <StandingItems employeeId={id} items={items ?? []} standing={Object.fromEntries((standing ?? []).map((x) => [x.pay_item_id, String(x.amount)]))} />
      {e.department === "site" && (
        <Allocations employeeId={id} projects={projects ?? []} current={latest.map((a) => ({ project_id: a.project_id, percent: String(Number(a.percent)) }))}
          since={latest[0]?.effective_from ?? null} />
      )}
      <Card>
        <CardHeader title="Salary advances" subtitle={`Still owed: ${money(laariToNumber(owed))}`} />
        {(recov ?? []).length > 0 && <p className="px-5 pt-3 text-sm text-[var(--muted)]">Recovered from pay: {(recov ?? []).filter((r) => r.active).map((r) => `${m(r.instalment)} a month from ${date(r.start_month)}`).join("; ") || "none active"}</p>}
        <AdvanceForm employeeId={id} banks={banks ?? []} />
      </Card>
      <Card>
        <CardHeader title="Payslips" />
        {(slips ?? []).length === 0 ? <Empty message="No payslips yet." /> : (
          <Table>
            <thead><tr><Th>Month</Th><Th right>Gross</Th><Th right>Net</Th><Th right> </Th></tr></thead>
            <tbody>
              {(slips ?? []).map((p) => { const r = p.payroll_runs as unknown as Run; return (
                <tr key={p.id}><Td><Link href={`/payroll/runs/${r.id}`} className="hover:underline">{date(r.period_month)}</Link></Td><Td right>{m(p.gross)}</Td><Td right>{m(p.net)}</Td>
                  <Td right><Link href={`/print/payslips/${r.id}?slip=${p.id}`} className="text-xs font-medium text-[var(--brand)] hover:underline">Payslip</Link></Td></tr>
              ); })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
