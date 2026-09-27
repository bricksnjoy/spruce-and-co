import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { date, dateTime, money, today } from "@/lib/format";
import { loadStatements } from "@/lib/statements-data";
import { AccountingTabs } from "../nav";
import { CloseYear, YearForm } from "./year-client";

export const dynamic = "force-dynamic";

export default async function YearEndPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const now = today();
  const thisYear = Number(now.slice(0, 4));
  const want = /^\d{4}$/.test(sp.year ?? "") ? sp.year : String(thisYear - 1);
  const data = await loadStatements(supabase, want);
  const year = data.current.year;
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: fy }, { data: signatories }, { count: openLines }, { data: stmts }, { data: capitalBills }, { data: assets }, { data: meRow }] = await Promise.all([
    supabase.from("financial_years").select("*").eq("year", year).maybeSingle(),
    supabase.from("signatories").select("id, name, title").eq("active", true).order("sort_order").order("name"),
    supabase.from("bank_lines").select("id", { count: "exact", head: true }).eq("status", "open").gte("line_date", from).lte("line_date", to),
    supabase.from("bank_statements").select("period_to").order("period_to", { ascending: false }).limit(1),
    supabase.from("bills").select("id").eq("expense_class", "capital").gte("issue_date", from).lte("issue_date", to),
    supabase.from("assets").select("bill_id"),
    supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle(),
  ]);
  const closer = fy?.closed_by ? (await supabase.from("profiles").select("full_name, email").eq("id", fy.closed_by).maybeSingle()).data : null;
  const registered = new Set((assets ?? []).map((a) => a.bill_id).filter(Boolean));
  const unregistered = (capitalBills ?? []).filter((b) => !registered.has(b.id)).length;
  const bankTo = stmts?.[0]?.period_to as string | undefined;
  const c = data.current;
  const snapshot = {
    revenue: Math.round(c.performance.revenue),
    profit: Math.round(c.performance.pat),
    total_assets: Math.round(c.position.totalAssets),
    equity: Math.round(c.position.equity.total),
    cash: Math.round(c.cashflow.closing),
  };
  const saved = (fy?.snapshot ?? null) as Record<string, number> | null;
  const drift = saved ? Object.entries(snapshot).filter(([k, v]) => Math.abs((saved[k] ?? 0) - v) >= 1) : [];
  const yearOver = now > to;

  const checks: { ok: boolean; label: string; detail: string; href?: string; must?: boolean }[] = [
    { ok: Math.abs(c.position.difference) < 1, label: "The books balance", detail: Math.abs(c.position.difference) < 1 ? "Assets equal liabilities plus equity." : `Off by ${money(c.position.difference)}.`, must: true },
    { ok: yearOver, label: "The year is over", detail: yearOver ? `Ended 31 December ${year}.` : `Runs to 31 December ${year}.`, must: true },
    {
      ok: Boolean(bankTo && bankTo >= `${year}-12-25`) && !openLines,
      label: "Bank reconciled",
      detail: !bankTo ? "No bank statement uploaded." : bankTo < `${year}-12-25` ? `Statements only go to ${date(bankTo)}.` : openLines ? `${openLines} bank lines in ${year} not matched or explained.` : "Every bank line in the year is matched or explained.",
      href: "/accounting/bank",
    },
    { ok: unregistered === 0, label: "Equipment registered", detail: unregistered ? `${unregistered} equipment bills in ${year} are not in the register.` : "Every equipment bill is in the register.", href: "/accounting/equipment" },
    { ok: c.taxFiled, label: "Tax worksheet done", detail: c.taxFiled ? "The statements use the worked-out tax." : "The statements use an estimate.", href: `/accounting/tax?year=${year}` },
    { ok: Boolean(fy?.principal_activity && fy?.directors), label: "Directors' report filled in", detail: fy?.directors ? "Principal activity and directors entered." : "Add the principal activity and the directors below." },
    { ok: Boolean(fy?.approved_on && fy?.signatory_id), label: "Board approval recorded", detail: fy?.approved_on ? `Approved ${date(fy.approved_on)}.` : "Add the approval date and who signs, below." },
    { ok: true, label: "Self-audit looked at", detail: "Clear anything high priority before closing.", href: "/accounting/audit" },
  ];

  return (
    <div>
      <PageHeader title="Accounting" subtitle="Approve the statements and close the year" />
      <AccountingTabs active="/accounting/year-end" />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {data.years.map((y) => (
          <Link key={y} href={`/accounting/year-end?year=${y}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${y === year ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {y}
          </Link>
        ))}
        <a href={`/accounting/statements/xlsx?year=${year}`} className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--hover)]">Download Excel</a>
        <Link href={`/print/statements?year=${year}`} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)]">Print statements</Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title={`Before closing ${year}`} subtitle="Worth doing before the Board signs; only the first two are required" />
            <ul className="divide-y divide-[var(--border)] text-sm">
              {checks.map((k) => (
                <li key={k.label} className="flex items-start gap-3 px-5 py-2.5">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${k.ok ? "bg-emerald-600" : k.must ? "bg-red-600" : "bg-amber-500"}`}>{k.ok ? "✓" : "!"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{k.label}</span>
                    <span className="block text-xs text-[var(--muted)]">{k.detail}</span>
                  </span>
                  {k.href && <Link href={k.href} className="shrink-0 text-xs text-[var(--brand)] hover:underline">Open</Link>}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Directors' report and approval" subtitle="Printed as page 1 of the statements, and on the balance sheet" />
            <YearForm year={year} signatories={signatories ?? []} values={{
              principal_activity: fy?.principal_activity ?? "Interior fit-out, joinery and construction work in the Maldives.",
              directors: fy?.directors ?? "",
              report_note: fy?.report_note ?? "",
              approved_on: fy?.approved_on ?? "",
              signatory_id: fy?.signatory_id ?? "",
              show_stamp: fy?.show_stamp ?? true,
            }} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={fy?.closed_at ? `${year} is closed` : `Close ${year}`} />
            <div className="space-y-3 px-5 py-4 text-sm">
              {fy?.closed_at ? (
                <>
                  <p>Closed {dateTime(fy.closed_at)}{closer ? ` by ${closer.full_name || closer.email}` : ""}. Bills, invoices, payments, salaries, capital, profit shares, tax and equipment dated in {year} can no longer be added, changed or deleted.</p>
                  {drift.length ? (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                      Figures have moved since closing: {drift.map(([k, v]) => `${k.replace("_", " ")} ${money(saved![k])} → ${money(v)}`).join("; ")}. Usually a change in a later year&apos;s settings; check before re-issuing.
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-700">The figures still match what was closed.</p>
                  )}
                </>
              ) : (
                <p className="text-[var(--muted)]">
                  Closing locks every record dated in {year} so the approved statements can&apos;t change underneath. An admin can reopen it if a correction is needed; every change stays in the change log.
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-[var(--muted)]">Revenue</dt><dd className="text-right tabular-nums">{money(snapshot.revenue)}</dd>
                <dt className="text-[var(--muted)]">Profit for the year</dt><dd className="text-right tabular-nums">{money(snapshot.profit)}</dd>
                <dt className="text-[var(--muted)]">Total assets</dt><dd className="text-right tabular-nums">{money(snapshot.total_assets)}</dd>
                <dt className="text-[var(--muted)]">Equity</dt><dd className="text-right tabular-nums">{money(snapshot.equity)}</dd>
                <dt className="text-[var(--muted)]">Cash at year end</dt><dd className="text-right tabular-nums">{money(snapshot.cash)}</dd>
              </dl>
              <CloseYear year={year} closed={Boolean(fy?.closed_at)} canClose={yearOver && Math.abs(c.position.difference) < 1}
                isAdmin={meRow?.role === "admin"} snapshot={snapshot} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
