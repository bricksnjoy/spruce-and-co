import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { money } from "@/lib/format";
import { loadStatements } from "@/lib/statements-data";
import { FinancialStatements } from "@/components/financial-statements";
import { AccountingTabs } from "../nav";
import { StatementSettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year } = await searchParams;
  const supabase = await createClient();
  const data = await loadStatements(supabase, year);
  const c = data.current;
  const p = c.position;
  const balanced = Math.abs(p.difference) < 1 && Math.abs(data.prior.position.difference) < 1;
  const cashTies = Math.abs(c.cashflow.other) < 1;

  return (
    <div>
      <PageHeader title="Accounting" subtitle={`Financial statements for the year ended 31 December ${c.year}`} />
      <AccountingTabs active="/accounting/statements" />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {data.years.map((y) => (
          <Link key={y} href={`/accounting/statements?year=${y}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              y === c.year ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
            }`}>
            {y}
          </Link>
        ))}
        <Link href={`/print/statements?year=${c.year}`}
          className="ml-auto rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)]">
          Print / Save PDF
        </Link>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Revenue" value={money(c.performance.revenue)} hint={`${money(data.prior.performance.revenue)} in ${data.prior.year}`} />
        <Stat label="Profit for the year" value={money(c.performance.pat)} hint={`after ${money(c.performance.tax)} tax (estimate)`} tone={c.performance.pat >= 0 ? "good" : "bad"} />
        <Stat label="Total assets" value={money(p.totalAssets)} hint={`equity ${money(p.equity.total)}`} />
        <Stat label="Books balance" value={balanced && cashTies ? "Yes" : "No"}
          hint={balanced ? (cashTies ? "assets = liabilities + equity; cash flow ties to the bank" : `cash flow off by ${money(c.cashflow.other)}`) : `off by ${money(p.difference)}`}
          tone={balanced && cashTies ? "good" : "bad"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 overflow-x-auto rounded-xl bg-[#e9ecf0] py-6">
          <FinancialStatements data={data} />
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Figures the statements need" subtitle="Things the rest of the app does not record" />
            <StatementSettingsForm s={data.settings} />
          </Card>
          <Card>
            <CardHeader title="How these are worked out" />
            <ul className="list-disc space-y-1.5 px-5 py-4 pl-9 text-xs text-[var(--muted)]">
              <li>Every bill, invoice, client payment, salary, capital entry and profit share is posted as a double entry, so the balance sheet always balances.</li>
              <li>Revenue counts when a project is completed or invoiced. Its costs wait as work in progress until then.</li>
              <li>Bills marked as equipment are assets, written off over the equipment life. Other bills not on a project are administrative expenses.</li>
              <li>Profit shares are shares of profit, not costs. Kept in the business, they become partners&apos; capital.</li>
              <li>Business profit tax is an estimate from the rate and threshold set here. Check it against your MIRA return.</li>
              <li>Cash below zero is shown as a bank overdraft: usually costs recorded before the client payments that covered them. Setting the cash at the start fixes this.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
