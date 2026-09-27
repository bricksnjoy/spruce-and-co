import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { date, money } from "@/lib/format";
import { loadBooks } from "@/lib/statements-data";
import { performance } from "@/lib/statements";
import type { Adjustment } from "@/app/actions/books";
import { AccountingTabs } from "../nav";
import { RemoveTaxPayment, TaxPaymentForm, TaxWorksheet } from "./tax-client";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { bpt: "Business profit tax", gst: "GST", other: "Other tax or fee" };

export default async function TaxPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ L, settings, years, thisYear, records }, { data: payments }, { data: returns }, { data: closed }] = await Promise.all([
    loadBooks(supabase),
    supabase.from("tax_payments").select("*").order("paid_on", { ascending: false }),
    supabase.from("tax_returns").select("*"),
    supabase.from("financial_years").select("year").not("closed_at", "is", null),
  ]);
  // the worksheet defaults to last year: the one whose return is due
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : Math.min(thisYear - 1, years[0]);
  const ret = (returns ?? []).find((r) => r.year === year);
  const prev = (returns ?? []).find((r) => r.year === year - 1);
  const perf = (y: number) => performance(L, `${y}-01-01`, `${y}-12-31`);
  const p = perf(year);

  // a loss on last year's return carries forward
  const prevTaxable = prev
    ? perf(year - 1).pbt + (prev.adjustments as Adjustment[]).reduce((s, a) => s + (a.kind === "add" ? a.amount : -a.amount), 0) - Number(prev.loss_brought_forward)
    : 0;
  const suggestedLoss = prevTaxable < 0 ? -prevTaxable : 0;
  const defaults: Adjustment[] = [
    ...(p.depreciation ? [{ label: "Depreciation in the accounts", kind: "add" as const, amount: Math.round(p.depreciation) }] : []),
    ...(p.disposal > 0 ? [{ label: "Loss on disposal of equipment", kind: "add" as const, amount: Math.round(p.disposal) }] : []),
    ...(p.depreciation ? [{ label: "Capital allowances", kind: "less" as const, amount: Math.round(p.depreciation) }] : []),
  ];

  const paidFor = (y: number) => (payments ?? []).filter((x) => x.kind === "bpt" && String(x.period ?? "").includes(String(y))).reduce((s, x) => s + Number(x.amount), 0);
  const rows = years.filter((y) => y < thisYear || y === year).sort((a, b) => b - a).map((y) => {
    const r = (returns ?? []).find((x) => x.year === y);
    const pbt = perf(y).pbt;
    const tax = r ? Number(r.tax) : (Math.max(0, pbt - settings.bpt_threshold) * settings.bpt_rate) / 100;
    return { y, pbt, tax, filed: r?.filed_on ?? null, hasReturn: Boolean(r), paid: paidFor(y) };
  });
  const owed = L.filter((l) => l.acct === "tax").reduce((s, l) => s - l.amount, 0);
  const gstPaid = (payments ?? []).filter((x) => x.kind === "gst" && x.paid_on.startsWith(String(thisYear))).reduce((s, x) => s + Number(x.amount), 0);
  const isClosed = (closed ?? []).some((c) => c.year === year);

  return (
    <div>
      <PageHeader title="Accounting" subtitle="Business profit tax, GST and what has been paid to MIRA" />
      <AccountingTabs active="/accounting/tax" />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Profit tax owed" value={money(owed)} hint="charged less paid, all years" tone={owed > 1 ? "warn" : "good"} />
        <Stat label={`Profit tax ${year}`} value={money(ret ? Number(ret.tax) : rows.find((r) => r.y === year)?.tax ?? 0)} hint={ret ? (ret.filed_on ? `filed ${date(ret.filed_on)}` : "worksheet saved, not filed") : "estimate: no worksheet yet"} />
        <Stat label={`GST paid in ${thisYear}`} value={money(gstPaid)} hint={settings.gst_registered ? "registered" : "not registered"} />
        <Stat label="Tax rate" value={`${settings.bpt_rate}%`} hint={`above ${money(settings.bpt_threshold)} a year · change under Statements`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title={`Business profit tax worksheet — ${year}`}
              subtitle="From profit in the accounts to taxable profit, as on the MIRA return. Once saved, the statements use this figure instead of the estimate." />
            <div className="flex flex-wrap gap-2 border-b border-[var(--border)] px-5 py-2">
              {years.map((y) => (
                <Link key={y} href={`/accounting/tax?year=${y}`}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${y === year ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}>
                  {y}
                </Link>
              ))}
            </div>
            <TaxWorksheet key={year} year={year} pbt={p.pbt} rate={settings.bpt_rate} threshold={settings.bpt_threshold} closed={isClosed}
              saved={ret ? { adjustments: ret.adjustments as Adjustment[], loss: Number(ret.loss_brought_forward), filedOn: ret.filed_on, reference: ret.reference, note: ret.note } : null}
              defaults={defaults} suggestedLoss={suggestedLoss} />
          </Card>

          <Card>
            <CardHeader title="By year" />
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="px-5 py-2 font-medium">Year</th>
                  <th className="px-3 py-2 text-right font-medium">Profit before tax</th>
                  <th className="px-3 py-2 text-right font-medium">Tax</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-5 py-2 text-right font-medium">Still owed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r) => (
                  <tr key={r.y}>
                    <td className="px-5 py-2">
                      <Link href={`/accounting/tax?year=${r.y}`} className="font-medium hover:underline">{r.y}</Link>
                      <span className="ml-2 text-xs text-[var(--muted)]">{r.filed ? `filed ${date(r.filed)}` : r.hasReturn ? "worksheet" : "estimate"}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.pbt)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.tax)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.paid)}</td>
                    <td className={`px-5 py-2 text-right font-medium tabular-nums ${r.tax - r.paid > 1 ? "text-amber-700" : ""}`}>{money(Math.max(0, r.tax - r.paid))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-5 py-3 text-xs text-[var(--muted)]">Payments count against a year when their period mentions it, such as “2025”.</p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Record a payment to MIRA" />
            <TaxPaymentForm />
          </Card>
          <Card>
            <CardHeader title="Payments" subtitle={`${(payments ?? []).length} recorded`} />
            <ul className="max-h-[560px] divide-y divide-[var(--border)] overflow-y-auto text-sm">
              {(payments ?? []).map((x) => (
                <li key={x.id} className="px-5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{KIND[x.kind]}{x.period ? ` · ${x.period}` : ""}</span>
                    <span className="tabular-nums">{money(Number(x.amount))}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                    <span>{date(x.paid_on)}{x.reference ? ` · ${x.reference}` : ""}</span>
                    <RemoveTaxPayment id={x.id} />
                  </div>
                </li>
              ))}
              {!payments?.length && <li className="px-5 py-3 text-xs text-[var(--muted)]">None yet. Tax paid from the bank can also be recorded straight from the Bank tab.</li>}
            </ul>
          </Card>
          <p className="px-1 text-xs text-[var(--muted)]">
            {records.gstRegistered ? "GST collected on invoices is owed to MIRA; payments here reduce it." : "The company is not GST registered, so GST paid here is shown as recoverable."} This worksheet is a
            guide. Check the adjustments with your tax adviser before filing.
          </p>
        </div>
      </div>
    </div>
  );
}
