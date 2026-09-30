import type { Session } from "@/server/session";
import { dbToLaari } from "@/lib/money";
import { forecast, monthlyOn, type Flow, type Week } from "@/lib/cash-forecast";

const L = (v: number | string | null | undefined) => dbToLaari(v ?? 0);
export const FLOW_LABEL: Record<string, string> = {
  customers: "Customers (open invoices)", bills: "Bills", payroll: "Payroll", payroll_owed: "Salaries and payroll taxes owed",
  gst: "GST to MIRA", payouts: "Payouts released",
};

export type Forecast = { cash: bigint; weeks: Week[]; notes: string[] };

/**
 * The inputs to the 12-week forecast, from the current book: cash now, open
 * invoices and bills by due date, payroll, GST and released payouts.
 */
export async function loadForecast(s: Session, today: string): Promise<Forecast> {
  const [{ data: accts }, { data: bals }, { data: docs }, { data: gst }, { data: owed }, { data: proj }] = await Promise.all([
    s.supabase.from("accounts").select("id, subtype").in("subtype", ["bank", "cash", "undeposited", "salaries_payable", "pension_payable", "wht_payable"]),
    s.supabase.rpc("rpc_account_balances", {}),
    s.supabase.from("document_balances_v").select("type, due_date, date, balance").in("type", ["invoice", "bill"]).eq("is_draft", false).is("voided_at", null).gt("balance", 0),
    s.supabase.from("gst_periods_v").select("status, due_date, net, payable"),
    s.supabase.from("partner_statement_v").select("project_id, outstanding").gt("outstanding", 0),
    s.supabase.from("project_payouts_v").select("id, blocked"),
  ]);
  const bal = new Map(((bals ?? []) as { account_id: string; balance: number }[]).map((b) => [b.account_id, L(b.balance)]));
  const sum = (subs: string[]) => (accts ?? []).filter((a) => subs.includes(a.subtype as string)).reduce((t, a) => t + (bal.get(a.id) ?? 0n), 0n);
  const cash = sum(["bank", "cash", "undeposited"]);
  const notes: string[] = [];
  const receipts: Flow[] = [];
  const payments: Flow[] = [];
  for (const d of (docs ?? []) as { type: string; due_date: string | null; date: string; balance: number }[]) {
    (d.type === "invoice" ? receipts : payments).push({ date: d.due_date ?? d.date, amount: L(d.balance), kind: d.type === "invoice" ? "customers" : "bills" });
  }
  const payrollOwed = sum(["salaries_payable", "pension_payable", "wht_payable"]);
  if (payrollOwed > 0n) payments.push({ date: null, amount: payrollOwed, kind: "payroll_owed" });
  for (const g of (gst ?? []) as { status: string; due_date: string; net: number; payable: number }[]) {
    if (g.status === "filed" && L(g.payable) > 0n) payments.push({ date: g.due_date, amount: L(g.payable), kind: "gst" });
    if (g.status === "open" && L(g.net) > 0n) payments.push({ date: g.due_date, amount: L(g.net), kind: "gst" });
  }
  const released = new Set((proj ?? []).filter((p) => !p.blocked).map((p) => p.id));
  const payouts = ((owed ?? []) as { project_id: string; outstanding: number }[]).filter((o) => released.has(o.project_id)).reduce((t, o) => t + L(o.outstanding), 0n);
  if (payouts > 0n) payments.push({ date: null, amount: payouts, kind: "payouts" });

  if (s.canPayroll) {
    const { data: runs } = await s.supabase.from("payroll_runs_v").select("period_month, pay_date, status, net_total").in("status", ["approved", "posted"]).order("period_month", { ascending: false }).limit(1);
    const last = (runs ?? [])[0] as { period_month: string; pay_date: string; net_total: number } | undefined;
    if (last) {
      // the months after the last run, on the same day of the month
      const after = new Date(Date.UTC(Number(last.period_month.slice(0, 4)), Number(last.period_month.slice(5, 7)), 1)).toISOString().slice(0, 10);
      const from = after > today ? after : today;
      payments.push(...monthlyOn(from, Number(last.pay_date.slice(8, 10)), L(last.net_total), "payroll"));
      notes.push(`Payroll repeats the last run's net pay (${last.period_month.slice(0, 7)}) on day ${Number(last.pay_date.slice(8, 10))} of each month.`);
    } else {
      const { data: emp } = await s.supabase.from("employees").select("basic_salary").eq("active", true);
      const basic = (emp ?? []).reduce((t, e) => t + L(e.basic_salary), 0n);
      if (basic > 0n) { payments.push(...monthlyOn(today, 31, basic, "payroll")); notes.push("No payroll run yet: payroll is estimated as active employees' basic salaries at each month end."); }
    }
  } else notes.push("Payroll is left out: it needs payroll permission to see.");
  notes.push("Anything overdue, or owed now with no due date, is counted in the first week. Billing stages not yet invoiced have no date, so they are not included.");
  return { cash, weeks: forecast(today, cash, receipts, payments), notes };
}
