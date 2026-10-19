import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardHeader, Empty, PageHeader, Stat, Table, Th, Td } from "@/components/ui";
import { getSession } from "@/server/session";
import { date, money, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";
import { periodFor, periodLabel } from "@/lib/gst";

export const dynamic = "force-dynamic";
type P = { id: string; start_date: string; end_date: string; due_date: string; status: "open" | "filed" | "paid"; return_reference: string | null;
  output: number; input: number; net: number; payable: number; prior_output_adjustments: number; prior_input_adjustments: number };
const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v ?? 0)));

/** Taxes (§8, §9): every GST return with where it stands, the current one to date, and what is owed for payroll taxes. */
export default async function TaxesPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data: settings }, { data: periods }, { data: company }, { data: accts }, { data: bals }] = await Promise.all([
    s.supabase.from("settings").select("gst_period_months, gst_due_day").eq("id", true).maybeSingle(),
    s.supabase.from("gst_periods_v").select("*").order("start_date", { ascending: false }),
    s.supabase.from("company").select("gst_registered").eq("id", true).maybeSingle(),
    s.supabase.from("accounts").select("id, subtype").in("subtype", ["pension_payable", "wht_payable", "gst_refund"]),
    s.supabase.rpc("rpc_account_balances", {}),
  ]);
  const rows = (periods ?? []) as P[];
  const now = today();
  const cur = periodFor(now, settings?.gst_period_months ?? 3, settings?.gst_due_day ?? 28);
  const current = rows.find((p) => p.start_date === cur.start);
  const unpaid = rows.filter((p) => p.status === "filed");
  const overdue = rows.filter((p) => p.status !== "paid" && p.due_date < now && p.end_date < now);
  const bal = new Map(((bals ?? []) as { account_id: string; balance: number }[]).map((b) => [b.account_id, b.balance]));
  const bySub = (sub: string) => (accts ?? []).filter((a) => a.subtype === sub).reduce((t, a) => t + dbToLaari(bal.get(a.id) ?? 0), 0n);
  const carried = bySub("gst_refund");
  const owed = unpaid.reduce((t, p) => t + dbToLaari(p.payable), 0n);

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader title="Taxes" subtitle={`GST returns and payroll taxes · ${bookLabel(s.book)} book`} />
      {company && !company.gst_registered && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">The company is not marked as GST-registered (Settings → Company). Returns are still worked out from any GST on documents.</p>
      )}
      {overdue.length > 0 && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900">
          Past the due date: {overdue.map((p) => periodLabel(p.start_date, p.end_date)).join(", ")}.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label={`${periodLabel(cur.start, cur.end)} to date`} value={m(current?.net)} hint={`Output ${m(current?.output)} · input ${m(current?.input)}`} tone={current && Number(current.net) < 0 ? "good" : "default"} />
        <Stat label="Due" value={date(cur.due)} hint={`File and pay by the ${settings?.gst_due_day ?? 28}th`} />
        <Stat label="Filed, not yet paid" value={money(laariToNumber(owed))}
          hint={unpaid.length ? unpaid.map((p) => periodLabel(p.start_date, p.end_date)).join(", ") : "Nothing owed"} tone={unpaid.length ? "warn" : "default"} />
        <Stat label="Credit carried forward" value={money(laariToNumber(carried))} hint="Used against the next return that owes" />
      </div>
      <Card>
        <CardHeader title="GST returns" subtitle="A return appears once a document with GST is dated in it" />
        {rows.length === 0 ? <Empty message="No GST on any document yet." /> : (
          <Table>
            <thead><tr><Th>Period</Th><Th>Status</Th><Th right>Output tax</Th><Th right>Input tax</Th><Th right>Net</Th><Th right>Still owed</Th><Th>Due</Th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const adj = dbToLaari(p.prior_output_adjustments) !== 0n || dbToLaari(p.prior_input_adjustments) !== 0n;
                return (
                  <tr key={p.id} className="hover:bg-[var(--hover)]">
                    <Td><Link href={`/taxes/gst/${p.id}`} className="font-medium text-[var(--brand)] hover:underline">{periodLabel(p.start_date, p.end_date)}</Link>
                      {adj && <span className="ml-2 text-xs text-amber-700" title="Includes documents from earlier, filed periods">adjustments</span>}</Td>
                    <Td><Badge value={p.status} /></Td>
                    <Td right>{m(p.output)}</Td>
                    <Td right>{m(p.input)}</Td>
                    <Td right className="font-medium">{m(p.net)}</Td>
                    <Td right>{p.status === "open" ? "" : m(p.payable)}</Td>
                    <Td className={p.status !== "paid" && p.due_date < now ? "text-red-700" : ""}>{date(p.due_date)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title="Payroll taxes" subtitle="Held back from salaries and owed to the Pension Office and MIRA"
          action={s.canPayroll ? <Link href="/payroll/remittances" className="text-sm font-medium text-[var(--brand)] hover:underline">Record a payment</Link> : undefined} />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 text-sm">
          <p>Pension owed <strong className="block text-lg tabular-nums">{money(laariToNumber(bySub("pension_payable")))}</strong></p>
          <p>Withholding tax owed <strong className="block text-lg tabular-nums">{money(laariToNumber(bySub("wht_payable")))}</strong></p>
        </div>
      </Card>
    </div>
  );
}
