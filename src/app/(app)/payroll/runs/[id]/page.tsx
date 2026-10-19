import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getSession } from "@/server/session";
import { date, money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { NoPayrollAccess } from "@/components/payroll/no-access";
import { RunEditor, type Slip } from "@/components/payroll/run-editor";

export const dynamic = "force-dynamic";
const monthName = (d: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.canPayroll) return <NoPayrollAccess />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: run } = await s.supabase.from("payroll_runs_v").select("*").eq("id", id).maybeSingle();
  if (!run) notFound();
  const [{ data: slips }, { data: items }, { data: emps }, { data: projects }, { data: banks }] = await Promise.all([
    s.supabase.from("payslips").select("id, gross, deductions, employer_contributions, net, employee_id, employees(name, department, nationality_type, job_title), payslip_lines(id, quantity, rate, amount, computed, pay_item_id, pay_items(code, name, kind, sort_order)), labour_allocations(id, project_id, quantity, amount, projects(code))").eq("run_id", id),
    s.supabase.from("pay_items").select("id, code, name, kind, calc").eq("active", true).in("calc", ["fixed", "hours", "days"]).order("sort_order"),
    s.supabase.from("employees").select("id, name").eq("active", true).order("name"),
    s.supabase.from("projects").select("id, code, name").is("archived_at", null).order("code"),
    s.supabase.from("accounts").select("id, code, name").in("subtype", ["bank", "cash"]).eq("active", true).order("code"),
  ]);
  const list = ((slips ?? []) as unknown as Slip[]).sort((a, b) => a.employees.name.localeCompare(b.employees.name));
  const inRun = new Set(list.map((x) => x.employee_id));
  const sum = (k: "gross" | "deductions" | "employer_contributions" | "net") => money(laariToNumber(list.reduce((a, x) => a + dbToLaari(x[k]), 0n)));
  const editable = run.status === "draft" || run.status === "review";

  return (
    <div className="max-w-6xl space-y-5">
      <Link href="/payroll" className="text-xs text-[var(--muted)] hover:underline">← Payroll</Link>
      <PageHeader title={`Payroll · ${monthName(run.period_month)}`} subtitle={`Pay date ${date(run.pay_date)} · ${list.length} payslip${list.length === 1 ? "" : "s"}`}
        action={<div className="flex items-center gap-3"><Badge value={run.display_status === "posted" ? "approved" : run.display_status} />
          <Link href={`/print/payslips/${id}`} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--brand-soft)]">Print payslips</Link></div>} />
      <div className="grid gap-4 sm:grid-cols-4">
        {[["Gross pay", sum("gross")], ["Deductions", sum("deductions")], ["Employer pension", sum("employer_contributions")], ["Net pay", sum("net")]].map(([l, v]) => (
          <Card key={l} className="px-5 py-4"><p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{l}</p><p className="mt-2 text-xl font-semibold tabular-nums">{v}</p></Card>
        ))}
      </div>
      <RunEditor runId={id} status={run.status} displayStatus={run.display_status} editable={editable} isAdmin={s.role === "admin"}
        slips={list} payItems={items ?? []} projects={projects ?? []} banks={banks ?? []}
        notInRun={(emps ?? []).filter((e) => !inRun.has(e.id))} payDate={run.pay_date} />
    </div>
  );
}
