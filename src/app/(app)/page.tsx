import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Stat, Table, Th, Td } from "@/components/ui";
import { ForecastChart } from "@/components/dashboard/forecast-chart";
import { getSession } from "@/server/session";
import { date, money, pct, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";
import { periodFor, periodLabel } from "@/lib/gst";
import { fiscalYearStart } from "@/lib/report-period";
import { profitOf } from "@/lib/report-model";
import { tb } from "@/server/reports/common";
import { loadForecast } from "@/server/dashboard";

export const dynamic = "force-dynamic";

const L = (v: number | string | null | undefined) => dbToLaari(v ?? 0);
const m = (v: bigint) => money(laariToNumber(v));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;

function Link2({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-xs font-medium text-[var(--brand)] hover:underline">{children}</Link>;
}

/** The dashboard (§9, §8): where cash, customers, vendors, projects, payroll, GST and payouts stand today. */
export default async function DashboardPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const t = today();
  const monthStart = `${t.slice(0, 8)}01`;
  const [{ data: profile }, { data: st }, { data: accts }, { data: bals }, { data: contacts }, { data: projects }, { data: payouts }, { data: pending }, { data: recons }, { data: gstRows }] = await Promise.all([
    s.supabase.from("profiles").select("full_name").eq("id", s.userId).maybeSingle(),
    s.supabase.from("settings").select("fiscal_year_start_month, gst_period_months, gst_due_day").eq("id", true).maybeSingle(),
    s.supabase.from("accounts").select("id, code, name, subtype").in("subtype", ["bank", "cash", "undeposited"]).eq("active", true).order("code"),
    s.supabase.rpc("rpc_account_balances", {}),
    s.supabase.from("contact_balances_v").select("receivable, payable, overdue_receivable, overdue_payable"),
    s.supabase.from("project_list_v").select("id, code, name, customer_name, stage, revised, billed, billed_pct, forecast_profit, margin_pct").is("archived_at", null).eq("stage", "active").order("revised", { ascending: false }).limit(8),
    s.supabase.from("project_payouts_v").select("id, blocked, returns_outstanding, principal_outstanding"),
    s.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("type", "payout").eq("is_draft", true).is("voided_at", null),
    s.supabase.from("reconciliations").select("account_id, statement_date, status").eq("status", "completed"),
    s.supabase.from("gst_periods_v").select("id, start_date, end_date, due_date, status, net, payable").order("start_date", { ascending: false }),
  ]);
  const fy = st?.fiscal_year_start_month ?? 1;
  const [month, ytd, fc] = await Promise.all([
    tb(s, { from: monthStart, to: t }), tb(s, { from: fiscalYearStart(t, fy), to: t }), loadForecast(s, t),
  ]);
  const firstName = (profile?.full_name ?? "").trim().split(/\s+/)[0];
  const bal = new Map(((bals ?? []) as { account_id: string; balance: number }[]).map((b) => [b.account_id, L(b.balance)]));
  const cashAccts = (accts ?? []).map((a) => ({ ...a, balance: bal.get(a.id) ?? 0n }));
  const cash = cashAccts.reduce((x, a) => x + a.balance, 0n);
  const sumC = (k: "receivable" | "payable" | "overdue_receivable" | "overdue_payable") => (contacts ?? []).reduce((x, c) => x + L(c[k]), 0n);
  const revenue = (a: typeof month) => a.filter((x) => x.type === "income").reduce((v, x) => v + x.credit - x.debit, 0n);

  // reconciliation is due when an account's last finished one is before the end of last month
  const lastMonthEnd = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const lastRecon = new Map<string, string>();
  for (const r of (recons ?? []) as { account_id: string; statement_date: string }[]) if (!lastRecon.has(r.account_id) || lastRecon.get(r.account_id)! < r.statement_date) lastRecon.set(r.account_id, r.statement_date);
  const reconDue = cashAccts.filter((a) => a.subtype === "bank" && (lastRecon.get(a.id) ?? "") < lastMonthEnd && (a.balance !== 0n || lastRecon.has(a.id)));

  // GST: the current period to date, and any filed but unpaid
  const cur = periodFor(t, st?.gst_period_months ?? 3, st?.gst_due_day ?? 28);
  const gst = (gstRows ?? []) as { id: string; start_date: string; end_date: string; due_date: string; status: string; net: number; payable: number }[];
  const curGst = gst.find((g) => g.start_date === cur.start);
  const unpaid = gst.filter((g) => g.status === "filed");

  // payouts
  const pp = (payouts ?? []) as { blocked: boolean; returns_outstanding: number; principal_outstanding: number }[];
  const owed = (x: (typeof pp)[number]) => L(x.returns_outstanding) + L(x.principal_outstanding);
  const ready = pp.filter((x) => !x.blocked).reduce((v, x) => v + owed(x), 0n);
  const blocked = pp.filter((x) => x.blocked).reduce((v, x) => v + owed(x), 0n);

  // next payroll (payroll permission only)
  let payroll: { label: string; hint: string; href: string } | null = null;
  if (s.canPayroll) {
    const { data: runs } = await s.supabase.from("payroll_runs_v").select("id, period_month, pay_date, display_status, net_total").order("period_month", { ascending: false }).limit(1);
    const r = (runs ?? [])[0] as { id: string; period_month: string; pay_date: string; display_status: string; net_total: number } | undefined;
    if (r && r.display_status !== "paid") payroll = { label: `${MON[Number(r.period_month.slice(5, 7)) - 1]} ${r.period_month.slice(0, 4)} · ${r.display_status.replace(/_/g, " ")}`, hint: `Pay date ${date(r.pay_date)} · net ${m(L(r.net_total))}`, href: `/payroll/runs/${r.id}` };
    else {
      const next = r ? new Date(Date.UTC(Number(r.period_month.slice(0, 4)), Number(r.period_month.slice(5, 7)), 1)).toISOString().slice(0, 10) : monthStart;
      payroll = { label: `${MON[Number(next.slice(5, 7)) - 1]} ${next.slice(0, 4)} · not started`, hint: r ? `Last run ${MON[Number(r.period_month.slice(5, 7)) - 1]} paid · net ${m(L(r.net_total))}` : "No payroll run yet", href: "/payroll" };
    }
  }

  const low = fc.weeks.reduce((a, w) => (w.closing < a.closing ? w : a), fc.weeks[0]);
  return (
    <div className="max-w-7xl space-y-5">
      <PageHeader title={firstName ? `Welcome back, ${firstName}` : "Welcome back"} subtitle={`${date(t)} · ${bookLabel(s.book)} book`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cash and bank" value={m(cash)} hint={`${cashAccts.length} account${cashAccts.length === 1 ? "" : "s"}`} />
        <Stat label="Customers owe" value={m(sumC("receivable"))} hint={`${m(sumC("overdue_receivable"))} overdue`} tone={sumC("overdue_receivable") > 0n ? "warn" : "default"} />
        <Stat label="You owe vendors" value={m(sumC("payable"))} hint={`${m(sumC("overdue_payable"))} overdue`} tone={sumC("overdue_payable") > 0n ? "warn" : "default"} />
        <Stat label={`Profit, ${MON[Number(t.slice(5, 7)) - 1]}`} value={m(profitOf(month))} tone={profitOf(month) < 0n ? "bad" : "default"}
          hint={`Revenue ${m(revenue(month))} · year to date ${m(profitOf(ytd))}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Cash forecast, next 12 weeks" subtitle={`Lowest: ${m(low.closing)} in the week of ${short(low.start)}`} action={<Link2 href="/reports/cash-forecast">Week by week →</Link2>} />
          <div className="px-4 pb-3">
            <ForecastChart start={laariToNumber(fc.cash)} points={fc.weeks.map((w) => ({ label: short(w.start), start: w.start, closing: laariToNumber(w.closing), cashIn: laariToNumber(w.cashIn), cashOut: laariToNumber(w.cashOut) }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Cash by account" action={<Link2 href="/banking">Banking →</Link2>} />
          {cashAccts.length === 0 ? <Empty message="No bank or cash accounts." /> : (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {cashAccts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span><Link href={`/banking/${a.id}`} className="hover:underline">{a.name}</Link>
                    {reconDue.some((r) => r.id === a.id) && <span className="ml-2 text-xs text-amber-700">reconcile{lastRecon.has(a.id) ? ` (last ${date(lastRecon.get(a.id)!)})` : ""}</span>}</span>
                  <span className="tabular-nums">{m(a.balance)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">GST {periodLabel(cur.start, cur.end)} to date</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{m(L(curGst?.net))}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">File and pay by {date(cur.due)}</p>
          {unpaid.length > 0 && <p className="mt-1 text-xs text-red-700">Filed, not paid: {unpaid.map((g) => `${periodLabel(g.start_date, g.end_date)} ${m(L(g.payable))}`).join(", ")}</p>}
          <div className="mt-2"><Link2 href="/taxes">Taxes →</Link2></div>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Next payroll</p>
          {payroll ? <>
            <p className="mt-2 text-base font-semibold">{payroll.label}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{payroll.hint}</p>
            <div className="mt-2"><Link2 href={payroll.href}>Payroll →</Link2></div>
          </> : <p className="mt-2 text-sm text-[var(--muted)]">Needs payroll permission.</p>}
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Payouts</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{m(ready)}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">ready to pay · {m(blocked)} blocked</p>
          {(pending?.length ?? 0) > 0 && <p className="mt-1 text-xs text-amber-700">Payouts awaiting approval</p>}
          <div className="mt-2"><Link2 href="/partners">Partners & financing →</Link2></div>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Reconciliation</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{reconDue.length}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{reconDue.length === 1 ? "account is" : "accounts are"} not reconciled to {date(lastMonthEnd)}</p>
          <div className="mt-2"><Link2 href="/banking">Banking →</Link2></div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Active projects" subtitle="By contract value" action={<Link2 href="/projects">All projects →</Link2>} />
        {(projects ?? []).length === 0 ? <Empty message="No active projects." /> : (
          <Table>
            <thead><tr><Th>Project</Th><Th right>Contract value</Th><Th right>Billed</Th><Th right>Forecast profit</Th><Th right>Margin</Th></tr></thead>
            <tbody>
              {(projects ?? []).map((p) => (
                <tr key={p.id}>
                  <Td><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    <p className="text-xs text-[var(--muted)]">{p.code}{p.customer_name ? ` · ${p.customer_name}` : ""}</p></Td>
                  <Td right>{m(L(p.revised))}</Td>
                  <Td right>{m(L(p.billed))} <span className="text-xs text-[var(--muted)]">{pct(Number(p.billed_pct), 0)}</span></Td>
                  <Td right className={L(p.forecast_profit) < 0n ? "text-red-700" : ""}>{m(L(p.forecast_profit))}</Td>
                  <Td right>{pct(Number(p.margin_pct), 1)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {fc.notes.length > 0 && <p className="text-xs text-[var(--muted)]">Forecast: {fc.notes.join(" ")}</p>}
    </div>
  );
}
