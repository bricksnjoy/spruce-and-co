import type { createClient } from "@/lib/supabase/server";
import { today as todayMv } from "@/lib/format";

/**
 * The company's books, drawn from what the rest of the app records: client
 * payments and paid invoices, supplier bills, salaries, the capital pool,
 * profit shares and investor repayments. Each real movement of money is
 * counted once; moves that only reallocate money inside the business (profit
 * retained as partners' capital, shares owed) are kept apart as transfers.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type EntryKind = "income" | "expense" | "capital_in" | "capital_out" | "distribution" | "transfer";

export interface Entry {
  id: string;
  date: string;
  kind: EntryKind;
  account: string;
  description: string;
  project: { id: string; code: string; name: string } | null;
  party: string | null;
  /** money in positive, out negative; transfers carry their size */
  amount: number;
  /** a real movement of money, not a reallocation */
  cash: boolean;
  href: string;
  source: string;
}

export const KIND_LABEL: Record<EntryKind, string> = {
  income: "Income",
  expense: "Expense",
  capital_in: "Capital in",
  capital_out: "Capital out",
  distribution: "Paid to partners & investors",
  transfer: "Transfer (no cash)",
};

export interface Period {
  key: string;
  from: string;
  to: string;
  label: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The period asked for in the address: a preset, or from/to dates. */
export function periodOf(sp: { p?: string; from?: string; to?: string }): Period {
  const today = todayMv();
  const [y, m] = today.split("-").map(Number);
  const first = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm - 1, 1)));
  const last = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm, 0)));
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const q = Math.floor((m - 1) / 3);
  switch (sp.p) {
    case "month":
      return { key: "month", from: first(y, m), to: last(y, m), label: "This month" };
    case "last-month": {
      const lm = m === 1 ? 12 : m - 1;
      const ly = m === 1 ? y - 1 : y;
      return { key: "last-month", from: first(ly, lm), to: last(ly, lm), label: "Last month" };
    }
    case "quarter":
      return { key: "quarter", from: first(y, q * 3 + 1), to: last(y, q * 3 + 3), label: `Q${q + 1} ${y}` };
    case "last-year":
      return { key: "last-year", from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) };
    case "all":
      return { key: "all", from: "2000-01-01", to: "2100-12-31", label: "All time" };
    case "custom": {
      const from = valid(sp.from) ?? `${y}-01-01`;
      const to = valid(sp.to) ?? today;
      return { key: "custom", from, to: to < from ? from : to, label: `${from} to ${to}` };
    }
    default:
      return { key: "year", from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
  }
}

export const PERIODS: [string, string][] = [
  ["month", "This month"],
  ["last-month", "Last month"],
  ["quarter", "This quarter"],
  ["year", "This year"],
  ["last-year", "Last year"],
  ["all", "All time"],
];

const n = (v: unknown) => Number(v ?? 0) || 0;
const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);

/** Everything the books are built from, loaded once. */
export async function loadRecords(supabase: Supabase) {
  const [
    { data: projects },
    { data: bills },
    { data: invoices },
    { data: invoiceTotals },
    { data: salaries },
    { data: pool },
    { data: members },
    { data: internal },
    { data: repayments },
    { data: investors },
    { data: variations },
    { data: quotations },
    { data: company },
  ] = await Promise.all([
    supabase.from("projects").select("id, code, name, status, contract_value, gst_amount, completed_at, payment_received_at, payment_received_amount, start_date, end_date"),
    supabase.from("bills").select("id, bill_no, vendor_id, project_id, category_id, status, issue_date, due_date, subtotal, tax_amount, total, amount_paid, description, attachment_path, gst_rate, created_at, vendors(name, tin), cost_categories(name)"),
    supabase.from("invoices").select("id, number, seq, project_id, client_id, to_name, title, issue_date, due_date, status, paid_at"),
    supabase.from("invoice_totals").select("invoice_id, subtotal, tax, total"),
    supabase.from("salary_payments").select("id, person_id, month, amount, paid_on, pool_entry_id, slip_path, people(name)"),
    supabase.from("capital_pool_entries").select("id, member_id, entry_type, amount, project_id, origin, entry_date, note"),
    supabase.from("capital_pool_members").select("id, name"),
    supabase.from("internal_account_entries").select("id, project_id, share_name, share_kind, investor_id, entry_type, amount, entry_date, source, note, disposition, pool_member_id"),
    supabase.from("investor_repayments").select("id, investor_id, project_id, kind, amount, paid_on, note, internal_entry_id"),
    supabase.from("investors").select("id, name"),
    supabase.from("variations").select("project_id, status, cost_impact"),
    supabase.from("quotations").select("id, number, project_id, status, issue_date"),
    supabase.from("company").select("gst_registered").eq("id", true).maybeSingle(),
  ]);
  return {
    projects: projects ?? [],
    bills: bills ?? [],
    invoices: invoices ?? [],
    invoiceTotals: invoiceTotals ?? [],
    salaries: salaries ?? [],
    pool: pool ?? [],
    members: members ?? [],
    internal: internal ?? [],
    repayments: repayments ?? [],
    investors: investors ?? [],
    variations: variations ?? [],
    quotations: quotations ?? [],
    gstRegistered: Boolean(company?.gst_registered),
  };
}

export type Records = Awaited<ReturnType<typeof loadRecords>>;

/** Every movement of money, oldest first. */
export function buildLedger(r: Records): Entry[] {
  const proj = new Map(r.projects.map((p) => [p.id, { id: p.id, code: p.code, name: p.name }]));
  const member = new Map(r.members.map((m) => [m.id, m.name]));
  const investor = new Map(r.investors.map((i) => [i.id, i.name]));
  const totals = new Map(r.invoiceTotals.map((t) => [t.invoice_id, n(t.total)]));
  const out: Entry[] = [];

  // income: paid invoices, and for projects without them, the payment recorded on the project
  const invoiced = new Set<string>();
  for (const inv of r.invoices) {
    if (inv.status !== "paid") continue;
    if (inv.project_id) invoiced.add(inv.project_id);
    out.push({
      id: `inv-${inv.id}`,
      date: day(inv.paid_at) ?? day(inv.issue_date)!,
      kind: "income",
      account: "Contract income",
      description: `Invoice ${inv.number ?? ""} paid${inv.title ? ` — ${inv.title}` : ""}`,
      project: inv.project_id ? proj.get(inv.project_id) ?? null : null,
      party: inv.to_name,
      amount: totals.get(inv.id) ?? 0,
      cash: true,
      href: `/invoices/${inv.id}`,
      source: "Invoice",
    });
  }
  for (const p of r.projects) {
    if (!p.payment_received_at || !n(p.payment_received_amount) || invoiced.has(p.id)) continue;
    out.push({
      id: `pay-${p.id}`,
      date: day(p.payment_received_at)!,
      kind: "income",
      account: "Contract income",
      description: `Client payment — ${p.code} ${p.name}`,
      project: proj.get(p.id) ?? null,
      party: null,
      amount: n(p.payment_received_amount),
      cash: true,
      href: `/projects/${p.id}`,
      source: "Project",
    });
  }

  // expenses: supplier bills and salaries
  for (const b of r.bills) {
    if (b.status === "void" || b.status === "draft") continue;
    const vendor = (b.vendors as unknown as { name: string } | null)?.name ?? null;
    const cat = (b.cost_categories as unknown as { name: string } | null)?.name ?? "Uncategorised";
    out.push({
      id: `bill-${b.id}`,
      date: day(b.issue_date) ?? day(b.created_at)!,
      kind: "expense",
      account: cat,
      description: `${b.bill_no ? `Bill ${b.bill_no}` : "Bill"}${b.description ? ` — ${b.description}` : ""}`,
      project: b.project_id ? proj.get(b.project_id) ?? null : null,
      party: vendor,
      amount: -n(b.total),
      cash: true,
      href: b.project_id ? `/projects/${b.project_id}` : "/projects",
      source: "Bill",
    });
  }
  const salaryPool = new Set(r.salaries.map((s) => s.pool_entry_id).filter(Boolean));
  for (const s of r.salaries) {
    out.push({
      id: `sal-${s.id}`,
      date: day(s.paid_on) ?? day(s.month)!,
      kind: "expense",
      account: "Salaries",
      description: `Salary for ${String(s.month).slice(0, 7)}`,
      project: null,
      party: (s.people as unknown as { name: string } | null)?.name ?? null,
      amount: -n(s.amount),
      cash: true,
      href: "/salaries",
      source: "Salary",
    });
  }

  // the capital pool: money put in or taken out; profit kept in the business is a transfer
  for (const e of r.pool) {
    if (salaryPool.has(e.id) || e.origin === "salary") continue; // the salary itself is the movement
    const kept = e.entry_type === "profit" || (e.entry_type === "contribution" && e.origin === "payment_received") || e.entry_type === "adjustment";
    out.push({
      id: `pool-${e.id}`,
      date: day(e.entry_date)!,
      kind: kept ? "transfer" : e.entry_type === "withdrawal" ? "capital_out" : "capital_in",
      account: e.entry_type === "withdrawal" ? "Capital withdrawn" : e.entry_type === "profit" ? "Profit kept as capital" : e.entry_type === "adjustment" ? "Capital adjustment" : kept ? "Profit kept as capital" : "Capital contributed",
      description: e.note || `Capital pool ${e.entry_type}`,
      project: e.project_id ? proj.get(e.project_id) ?? null : null,
      party: member.get(e.member_id) ?? null,
      amount: n(e.amount),
      cash: !kept,
      href: "/capital-pool",
      source: "Capital pool",
    });
  }

  // profit shares: owed on completion (transfer), and paid when the client pays
  const repaid = new Set(r.repayments.map((x) => x.internal_entry_id).filter(Boolean));
  for (const e of r.internal) {
    if (e.entry_type === "settlement" && repaid.has(e.id)) continue;
    const intoPool = Boolean(e.pool_member_id);
    const paidOut = e.entry_type === "settlement" && !intoPool;
    out.push({
      id: `int-${e.id}`,
      date: day(e.entry_date)!,
      kind: paidOut ? "distribution" : "transfer",
      account: e.entry_type === "accrual" ? "Profit share owed" : intoPool ? "Profit share kept as capital" : "Profit share paid",
      description: `${e.share_name}${e.note ? ` — ${e.note}` : ""}`,
      project: e.project_id ? proj.get(e.project_id) ?? null : null,
      party: e.investor_id ? investor.get(e.investor_id) ?? e.share_name : e.share_name,
      amount: n(e.amount),
      cash: paidOut,
      href: "/internal",
      source: "Internal account",
    });
  }
  for (const x of r.repayments) {
    out.push({
      id: `rep-${x.id}`,
      date: day(x.paid_on)!,
      kind: "distribution",
      account: x.kind === "profit" ? "Investor profit paid" : "Investor capital repaid",
      description: x.note || `Investor ${x.kind} repayment`,
      project: x.project_id ? proj.get(x.project_id) ?? null : null,
      party: investor.get(x.investor_id) ?? null,
      amount: -n(x.amount),
      cash: true,
      href: `/investors/${x.investor_id}`,
      source: "Investor",
    });
  }
  return out.filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Profit and loss, cash and balances for a period. */
export function summarise(entries: Entry[], period: Period) {
  const inP = entries.filter((e) => e.date >= period.from && e.date <= period.to);
  const sum = (xs: Entry[]) => xs.reduce((s, e) => s + e.amount, 0);
  const income = sum(inP.filter((e) => e.kind === "income"));
  const expenses = -sum(inP.filter((e) => e.kind === "expense"));
  const byAccount = new Map<string, number>();
  for (const e of inP.filter((x) => x.kind === "expense")) byAccount.set(e.account, (byAccount.get(e.account) ?? 0) - e.amount);
  const cashBefore = sum(entries.filter((e) => e.cash && e.date < period.from));
  const cashMoved = sum(inP.filter((e) => e.cash));
  // month by month, for the chart
  const months = new Map<string, { income: number; expenses: number }>();
  for (const e of inP) {
    if (e.kind !== "income" && e.kind !== "expense") continue;
    const k = e.date.slice(0, 7);
    const m = months.get(k) ?? { income: 0, expenses: 0 };
    if (e.kind === "income") m.income += e.amount;
    else m.expenses -= e.amount;
    months.set(k, m);
  }
  return {
    income,
    expenses,
    profit: income - expenses,
    margin: income ? (income - expenses) / income : 0,
    byAccount: [...byAccount.entries()].sort((a, b) => b[1] - a[1]),
    capitalIn: sum(inP.filter((e) => e.kind === "capital_in")),
    capitalOut: -sum(inP.filter((e) => e.kind === "capital_out")),
    distributions: -sum(inP.filter((e) => e.kind === "distribution")),
    cashBefore,
    cashMoved,
    cashAfter: cashBefore + cashMoved,
    months: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    count: inP.length,
  };
}

const daysSince = (d: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);

/** Who owes the company, and how long it has been waiting. */
export function receivables(r: Records) {
  const today = todayMv();
  const totals = new Map(r.invoiceTotals.map((t) => [t.invoice_id, n(t.total)]));
  const variation = (id: string) => r.variations.filter((v) => v.project_id === id && v.status === "approved").reduce((s, v) => s + n(v.cost_impact), 0);
  const rows: { id: string; what: string; party: string | null; since: string; amount: number; days: number; href: string }[] = [];
  const invoicedProjects = new Set(r.invoices.filter((i) => i.status !== "cancelled").map((i) => i.project_id).filter(Boolean));
  for (const inv of r.invoices) {
    if (inv.status !== "sent") continue;
    const since = day(inv.due_date) ?? day(inv.issue_date)!;
    rows.push({ id: `inv-${inv.id}`, what: `Invoice ${inv.number}`, party: inv.to_name, since, amount: totals.get(inv.id) ?? 0, days: Math.max(0, daysSince(since, today)), href: `/invoices/${inv.id}` });
  }
  for (const p of r.projects) {
    if (p.status !== "completed" || p.payment_received_at || invoicedProjects.has(p.id)) continue;
    const since = day(p.completed_at) ?? day(p.end_date) ?? today;
    rows.push({ id: `proj-${p.id}`, what: `${p.code} ${p.name} (completed, not paid)`, party: null, since, amount: n(p.contract_value) + variation(p.id), days: Math.max(0, daysSince(since, today)), href: `/projects/${p.id}` });
  }
  return rows.sort((a, b) => b.days - a.days);
}

/** What the company owes suppliers. */
export function payables(r: Records) {
  const today = todayMv();
  return r.bills
    .filter((b) => ["awaiting_approval", "approved", "part_paid", "disputed"].includes(b.status))
    .map((b) => {
      const since = day(b.due_date) ?? day(b.issue_date) ?? today;
      return {
        id: b.id,
        what: `${b.bill_no ? `Bill ${b.bill_no}` : "Bill"}${b.description ? ` — ${b.description}` : ""}`,
        party: (b.vendors as unknown as { name: string } | null)?.name ?? null,
        status: b.status as string,
        since,
        amount: n(b.total) - n(b.amount_paid),
        days: Math.max(0, daysSince(since, today)),
        href: b.project_id ? `/projects/${b.project_id}` : "/projects",
      };
    })
    .filter((x) => x.amount > 0.005)
    .sort((a, b) => b.days - a.days);
}

export const AGE_BUCKETS: [string, number, number][] = [
  ["Current", 0, 0],
  ["1–30 days", 1, 30],
  ["31–60 days", 31, 60],
  ["61–90 days", 61, 90],
  ["Over 90 days", 91, Infinity],
];

export function aged<T extends { days: number; amount: number }>(rows: T[]) {
  return AGE_BUCKETS.map(([label, lo, hi]) => {
    const inB = rows.filter((x) => x.days >= lo && x.days <= hi);
    return { label, count: inB.length, amount: inB.reduce((s, x) => s + x.amount, 0) };
  });
}

/** A ledger as CSV, for a spreadsheet or an accountant. */
export function ledgerCsv(entries: Entry[]) {
  const head = ["Date", "Type", "Account", "Description", "Project", "Party", "In", "Out", "Cash", "Source"];
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [
    head.join(","),
    ...entries.map((e) =>
      [
        e.date,
        KIND_LABEL[e.kind],
        e.account,
        e.description,
        e.project ? `${e.project.code} ${e.project.name}` : "",
        e.party ?? "",
        e.amount > 0 ? e.amount.toFixed(2) : "",
        e.amount < 0 ? (-e.amount).toFixed(2) : "",
        e.cash ? "yes" : "no",
        e.source,
      ].map((x) => cell(String(x))).join(","),
    ),
  ].join("\n");
}
