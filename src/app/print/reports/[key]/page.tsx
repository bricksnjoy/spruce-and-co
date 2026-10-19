import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { PrintToolbar } from "../../toolbar";
import { LedgerSheet, type Company } from "@/components/sales/ledger-sheet";
import { ReportTable } from "@/components/reports/report-table";
import { runReport } from "@/server/reports/run";
import { yearEndPack } from "@/server/reports/pack";
import { paramQuery } from "@/server/reports";
import type { Report } from "@/lib/report-model";

export const dynamic = "force-dynamic";

/** A report on A4 sheets, to print or save as PDF; "year-end" prints the whole pack for the auditor. */
export default async function PrintReport({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ key }, q] = await Promise.all([params, searchParams]);
  const { data: company } = await s.supabase.from("company")
    .select("legal_name, trade_name, tin, gst_registered, taxable_activity_no, address, phone, email, bank_details").eq("id", true).maybeSingle();
  if (!company) notFound();
  let reports: Report[];
  let back = "/reports";
  let skipped: string[] = [];
  if (key === "year-end") {
    const pack = await yearEndPack(s, q);
    reports = pack.reports; skipped = pack.skipped;
  } else {
    const ran = await runReport(s, key, q);
    if ("error" in ran) { if (ran.status === 404) notFound(); return <p className="p-8 text-sm text-red-700">{ran.error}</p>; }
    reports = [ran.report];
    back = `/reports/${key}?${paramQuery(ran.params)}`;
  }
  const title = key === "year-end" ? "Year-end pack" : reports[0]?.title ?? "Report";
  const test = s.book === "sandbox";
  return (
    <>
      <title>{title}</title>
      <PrintToolbar back={back} filename={title} />
      <div className="space-y-6 print:space-y-0">
        {reports.map((r, i) => (
          <div key={i} className="break-after-page">
            <LedgerSheet company={company as Company} title={r.title.toUpperCase()}>
              {test && <p className="mb-2 text-[10px] font-bold text-red-700">TEST BOOK — NOT REAL FIGURES</p>}
              {r.subtitle && <p className="mb-1 text-[11px] font-semibold">{r.subtitle}</p>}
              <p className="mb-4 text-[9px] italic">All amounts in Maldivian Rufiyaa</p>
              <ReportTable report={r} print />
            </LedgerSheet>
          </div>
        ))}
        {skipped.length > 0 && <div className="mx-auto max-w-[210mm] text-xs text-[var(--muted)] print:hidden">{skipped.map((x) => <p key={x}>Left out — {x}</p>)}</div>}
      </div>
    </>
  );
}
