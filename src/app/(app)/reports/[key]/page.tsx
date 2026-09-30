import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { ReportTable } from "@/components/reports/report-table";
import { ReportFilters, SaveReport } from "@/components/reports/filters";
import { small } from "@/components/form-styles";
import { getSession } from "@/server/session";
import { bookLabel } from "@/lib/books";
import { paramQuery } from "@/server/reports";
import { runReport } from "@/server/reports/run";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ key }, q] = await Promise.all([params, searchParams]);
  const ran = await runReport(s, key, q);
  if ("error" in ran) {
    if (ran.status === 404) notFound();
    return (
      <div className="max-w-3xl space-y-4">
        <Link href="/reports" className="text-xs text-[var(--muted)] hover:underline">← Reports</Link>
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{ran.error}</p>
      </div>
    );
  }
  const { def, params: p, report } = ran;
  const f = def.filters;
  const [projects, contacts, accounts, employees] = await Promise.all([
    f.includes("project") ? s.supabase.from("projects").select("id, code, name").order("code").then((r) => (r.data ?? []).map((x) => ({ id: x.id, name: `${x.code} ${x.name}` }))) : undefined,
    f.includes("contact") ? s.supabase.from("contacts").select("id, name").eq("active", true).order("name").then((r) => r.data ?? []) : undefined,
    f.includes("account") ? s.supabase.from("accounts").select("id, code, name").eq("active", true).order("code").then((r) => (r.data ?? []).map((x) => ({ id: x.id, name: `${x.code} ${x.name}` }))) : undefined,
    f.includes("employee") && s.canPayroll ? s.supabase.from("employees").select("id, name").order("name").then((r) => r.data ?? []) : undefined,
  ]);
  const query = paramQuery(p);
  return (
    <div className="max-w-7xl space-y-5">
      <div><Link href="/reports" className="text-xs text-[var(--muted)] hover:underline">← Reports</Link></div>
      <PageHeader title={report.title} subtitle={`${report.subtitle ? `${report.subtitle} · ` : ""}${bookLabel(s.book)} book`}
        action={<div className="flex flex-wrap items-center gap-2">
          <a href={`/reports/${key}/export?${query}&format=csv`} className={small}>CSV</a>
          <a href={`/reports/${key}/export?${query}&format=xlsx`} className={small}>Excel</a>
          <Link href={`/print/reports/${key}?${query}`} className={small}>Print / PDF</Link>
          <SaveReport reportKey={key} query={query} />
        </div>} />
      {f.length > 0 && (
        <Card className="px-5 py-4">
          <ReportFilters reportKey={key} filters={f} by={def.by}
            values={{ preset: p.preset, from: p.range.from, to: p.range.to, compare: p.compare, project: p.project ?? "", contact: p.contact ?? "", account: p.account ?? "", employee: p.employee ?? "", by: p.by ?? "" }}
            options={{ projects, contacts, accounts, employees }} />
        </Card>
      )}
      <Card><ReportTable report={report} /></Card>
    </div>
  );
}
