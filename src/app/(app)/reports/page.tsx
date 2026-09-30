import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { DeleteSaved } from "@/components/reports/filters";
import { getSession } from "@/server/session";
import { bookLabel } from "@/lib/books";
import { ELSEWHERE, GROUPS, REPORTS, reportByKey } from "@/server/reports";

export const dynamic = "force-dynamic";

/** Every report (§11), grouped, with this user's saved views. */
export default async function ReportsPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const { data: saved } = await s.supabase.from("saved_reports").select("id, name, report, params").order("name");
  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader title="Reports" subtitle={`Statements, schedules and lists from the ledger · ${bookLabel(s.book)} book`}
        action={<div className="flex gap-3 text-sm">
          <Link href={`/print/reports/year-end?preset=last_year`} className="font-medium text-[var(--brand)] hover:underline">Year-end pack (last year, print/PDF)</Link>
          <Link href={`/reports/year-end/export?preset=last_year`} className="font-medium text-[var(--brand)] hover:underline">Year-end pack (Excel)</Link>
        </div>} />
      {(saved ?? []).length > 0 && (
        <Card>
          <CardHeader title="Saved views" />
          <ul className="divide-y divide-[var(--border)]">
            {(saved ?? []).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <Link href={`/reports/${v.report}?${new URLSearchParams(v.params as Record<string, string>)}`} className="font-medium text-[var(--brand)] hover:underline">{v.name}</Link>
                <span className="flex items-center gap-3 text-xs text-[var(--muted)]">{reportByKey(v.report)?.title}<DeleteSaved id={v.id} /></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {GROUPS.map((g) => {
          const items = [
            ...REPORTS.filter((r) => r.group === g && (!r.payroll || s.canPayroll)).map((r) => ({ href: `/reports/${r.key}`, title: r.title, description: r.description })),
            ...ELSEWHERE.filter((r) => r.group === g && (!r.payroll || s.canPayroll)),
          ];
          if (!items.length) return null;
          return (
            <Card key={g}>
              <CardHeader title={g} />
              <ul className="divide-y divide-[var(--border)]">
                {items.map((r) => (
                  <li key={r.href} className="px-5 py-2.5">
                    <Link href={r.href} className="text-sm font-medium text-[var(--brand)] hover:underline">{r.title}</Link>
                    <p className="text-xs text-[var(--muted)]">{r.description}</p>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-[var(--muted)]">Every report downloads as CSV or Excel and prints to PDF. Figures link through to the ledger and on to the document. The financial year starts in the month set in Settings → Accounting.</p>
    </div>
  );
}
