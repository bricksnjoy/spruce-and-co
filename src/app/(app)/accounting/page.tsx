import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { money, pct, date } from "@/lib/format";
import { aged, buildLedger, loadRecords, payables, periodOf, receivables, summarise } from "@/lib/accounting";
import { AccountingTabs, PeriodPicker } from "./nav";

export const dynamic = "force-dynamic";

export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ p?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const period = periodOf(sp);
  const supabase = await createClient();
  const records = await loadRecords(supabase);
  const entries = buildLedger(records);
  const s = summarise(entries, period);
  const owedIn = receivables(records);
  const owedOut = payables(records);
  const owedInTotal = owedIn.reduce((a, x) => a + x.amount, 0);
  const owedOutTotal = owedOut.reduce((a, x) => a + x.amount, 0);

  // what is held for partners and investors
  const poolBy = new Map<string, number>();
  for (const e of records.pool) poolBy.set(e.member_id, (poolBy.get(e.member_id) ?? 0) + Number(e.amount));
  const pool = records.members.map((m) => ({ name: m.name, amount: poolBy.get(m.id) ?? 0 })).filter((x) => Math.abs(x.amount) > 0.005);
  const shares = records.internal.reduce((a, e) => a + Number(e.amount), 0);
  const peak = Math.max(1, ...s.months.map(([, m]) => Math.max(m.income, m.expenses)));

  return (
    <div>
      <PageHeader title="Accounting" subtitle={`The books for ${period.label.toLowerCase() === "all time" ? "all time" : period.label}`} />
      <AccountingTabs active="/accounting" />
      <div className="mb-5"><PeriodPicker path="/accounting" period={period} /></div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Income" value={money(s.income)} hint="client payments received" tone="good" />
        <Stat label="Expenses" value={money(s.expenses)} hint="bills and salaries" />
        <Stat label="Net profit" value={money(s.profit)} hint={s.income ? `${pct(s.margin * 100)} margin` : "no income in this period"} tone={s.profit >= 0 ? "good" : "bad"} />
        <Stat label="Cash position" value={money(s.cashAfter)} hint={`${s.cashMoved >= 0 ? "+" : ""}${money(s.cashMoved)} in this period`} tone={s.cashAfter >= 0 ? "default" : "bad"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Profit and loss" subtitle={`${date(period.from > "2000-01-01" ? period.from : null)} – ${date(period.to < "2100-12-31" ? period.to : null)}`} />
          <table className="w-full text-sm">
            <tbody>
              <Line label="Contract income" value={s.income} bold />
              <tr><td colSpan={2} className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Less expenses</td></tr>
              {s.byAccount.length ? s.byAccount.map(([acc, v]) => (
                <Line key={acc} label={acc} value={-v} indent href={`/accounting/ledger?p=${period.key}${period.key === "custom" ? `&from=${period.from}&to=${period.to}` : ""}&account=${encodeURIComponent(acc)}`} />
              )) : <Line label="No expenses" value={0} indent />}
              <Line label="Total expenses" value={-s.expenses} bold />
              <Line label="Net profit" value={s.profit} bold top tone={s.profit >= 0 ? "good" : "bad"} />
              <tr><td colSpan={2} className="px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Below the line — money in and out that is not profit</td></tr>
              <Line label="Capital put in by partners" value={s.capitalIn} indent />
              <Line label="Capital taken out by partners" value={-s.capitalOut} indent />
              <Line label="Paid to partners and investors" value={-s.distributions} indent />
            </tbody>
          </table>
          <p className="px-5 pb-4 pt-2 text-xs text-[var(--muted)]">
            On a cash basis: income when the client pays, costs by bill date. Profit kept in the business as partners&apos; capital is not counted as
            money out.
          </p>
        </Card>

        <Card>
          <CardHeader title="Month by month" subtitle="Income against expenses" />
          {s.months.length ? (
            <div className="space-y-2 px-5 py-4">
              {s.months.map(([m, v]) => (
                <div key={m} className="grid grid-cols-[64px_1fr_110px] items-center gap-3 text-xs">
                  <span className="text-[var(--muted)]">{new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" })}</span>
                  <span className="space-y-0.5">
                    <span className="block h-2 rounded-full bg-emerald-600" style={{ width: `${(v.income / peak) * 100}%` }} title={`Income ${money(v.income)}`} />
                    <span className="block h-2 rounded-full bg-[var(--accent)]" style={{ width: `${(v.expenses / peak) * 100}%` }} title={`Expenses ${money(v.expenses)}`} />
                  </span>
                  <span className={`text-right font-medium tabular-nums ${v.income - v.expenses >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money(v.income - v.expenses)}</span>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-[var(--muted)]">
                <span className="mr-1 inline-block h-2 w-3 rounded-full bg-emerald-600 align-middle" /> income
                <span className="ml-3 mr-1 inline-block h-2 w-3 rounded-full bg-[var(--accent)] align-middle" /> expenses · right: profit for the month
              </p>
            </div>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">Nothing in this period.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Owed to the company" subtitle={`${money(owedInTotal)} from clients`} />
          <Aging rows={aged(owedIn)} />
          <ul className="divide-y divide-[var(--border)] text-sm">
            {owedIn.slice(0, 8).map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-5 py-2">
                <Link href={x.href} className="min-w-0 flex-1 truncate hover:underline">{x.what}</Link>
                <span className={`text-xs ${x.days > 30 ? "text-red-700" : "text-[var(--muted)]"}`}>{x.days ? `${x.days} days` : "not due yet"}</span>
                <span className="w-32 text-right font-medium tabular-nums">{money(x.amount)}</span>
              </li>
            ))}
            {!owedIn.length && <li className="px-5 py-4 text-center text-[var(--muted)]">Nothing outstanding.</li>}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Owed by the company" subtitle={`${money(owedOutTotal)} to suppliers`} />
          <Aging rows={aged(owedOut)} />
          <ul className="divide-y divide-[var(--border)] text-sm">
            {owedOut.slice(0, 8).map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-5 py-2">
                <Link href={x.href} className="min-w-0 flex-1 truncate hover:underline">{x.party ?? "Supplier"} · {x.what}</Link>
                <span className={`text-xs ${x.days > 30 ? "text-red-700" : "text-[var(--muted)]"}`}>{x.days ? `${x.days} days` : "not due yet"}</span>
                <span className="w-32 text-right font-medium tabular-nums">{money(x.amount)}</span>
              </li>
            ))}
            {!owedOut.length && <li className="px-5 py-4 text-center text-[var(--muted)]">No unpaid bills.</li>}
          </ul>
          <div className="border-t border-[var(--border)] px-5 py-3 text-sm">
            <div className="flex justify-between"><span className="text-[var(--muted)]">Profit shares owed to partners and investors</span><span className="font-medium tabular-nums">{money(shares)}</span></div>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Held as partners&apos; capital</p>
            {pool.map((x) => (
              <div key={x.name} className="flex justify-between"><span className="text-[var(--muted)]">{x.name}</span><span className={`tabular-nums ${x.amount < 0 ? "text-red-700" : ""}`}>{money(x.amount)}</span></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Line({ label, value, bold, indent, top, tone, href }: {
  label: string;
  value: number;
  bold?: boolean;
  indent?: boolean;
  top?: boolean;
  tone?: "good" | "bad";
  href?: string;
}) {
  return (
    <tr className={top ? "border-t-2 border-[var(--border)]" : ""}>
      <td className={`py-1.5 ${indent ? "pl-9" : "pl-5"} ${bold ? "font-semibold" : ""}`}>
        {href ? <Link href={href} className="hover:underline">{label}</Link> : label}
      </td>
      <td className={`py-1.5 pr-5 text-right tabular-nums ${bold ? "font-semibold" : ""} ${tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : ""}`}>
        {money(value)}
      </td>
    </tr>
  );
}

function Aging({ rows }: { rows: { label: string; count: number; amount: number }[] }) {
  return (
    <div className="grid grid-cols-5 gap-px border-b border-[var(--border)] bg-[var(--border)] text-center">
      {rows.map((b, i) => (
        <div key={b.label} className="bg-[var(--surface)] px-2 py-2">
          <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{b.label}</p>
          <p className={`text-xs font-semibold tabular-nums ${i >= 3 && b.amount ? "text-red-700" : ""}`}>{b.amount ? money(b.amount) : "—"}</p>
        </div>
      ))}
    </div>
  );
}
