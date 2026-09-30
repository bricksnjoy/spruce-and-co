import type { Session } from "@/server/session";
import { dbToLaari } from "@/lib/money";
import { date, titleize } from "@/lib/format";
import { rangeLabel } from "@/lib/report-period";
import { periodLabel } from "@/lib/gst";
import { profitOf, type Col, type Row } from "@/lib/report-model";
import { FLOW_LABEL, loadForecast } from "@/server/dashboard";
import { BUCKETS, daysPast, glHref, names, tb, txnHref, type Params, type ReportDef } from "./common";

const L = (v: number | string | null | undefined) => dbToLaari(v ?? 0);
const money = (key: string, label: string): Col => ({ key, label, kind: "money" });
const text = (key: string, label: string): Col => ({ key, label });
const sumRow = (rows: Row[], keys: string[], label = "Total", labelKey = "label"): Row => {
  const cells: Row["cells"] = { [labelKey]: label };
  for (const k of keys) cells[k] = rows.reduce((t, r) => t + (typeof r.cells[k] === "bigint" ? (r.cells[k] as bigint) : 0n), 0n);
  return { cells, style: "total" };
};

type Doc = { id: string; type: string; number: string | null; date: string; due_date: string | null; contact_id: string | null; project_id: string | null; total: number; balance: number };

/** Open documents of the given types with what is still owed on each. */
async function openDocs(s: Session, types: string[]) {
  const { data } = await s.supabase.from("document_balances_v").select("id, type, number, date, due_date, contact_id, project_id, total, balance")
    .in("type", types).eq("is_draft", false).is("voided_at", null).neq("balance", 0).order("due_date");
  const docs = (data ?? []) as Doc[];
  const nm = await names(s, "contacts", [...new Set(docs.map((d) => d.contact_id).filter(Boolean))] as string[]);
  return { docs, nm };
}

function aging(title: string, types: string[], detail: boolean, contactHref: (id: string) => string): ReportDef["build"] {
  return async (s, p) => {
    const { docs, nm } = await openDocs(s, types);
    const bucket = (d: Doc) => BUCKETS.find(([, , f]) => f(daysPast(d.due_date ?? d.date, p.today)))![0];
    const keys = BUCKETS.map(([k]) => k);
    if (detail) {
      const rows: Row[] = docs.map((d) => ({
        cells: { label: nm.get(d.contact_id ?? "") ?? "—", doc: `${titleize(d.type)} ${d.number ?? ""}`, date: d.date, due: d.due_date,
          days: Math.max(0, daysPast(d.due_date ?? d.date, p.today)), total: L(d.total), [bucket(d)]: L(d.balance), balance: L(d.balance) },
        href: txnHref(d.type, d.id),
      }));
      rows.push(sumRow(rows, ["total", ...keys, "balance"]));
      return { title, subtitle: `As at ${date(p.today)}`, columns: [text("label", "Name"), text("doc", "Document"), { key: "date", label: "Date", kind: "date" },
        { key: "due", label: "Due", kind: "date" }, { key: "days", label: "Days overdue", kind: "num" }, money("total", "Total"),
        ...BUCKETS.map(([k, l]) => money(k, l)), money("balance", "Open balance")], rows };
    }
    const by = new Map<string, Row>();
    for (const d of docs) {
      const id = d.contact_id ?? "";
      const r = by.get(id) ?? { cells: { label: nm.get(id) ?? "—", ...Object.fromEntries(keys.map((k) => [k, 0n])), balance: 0n }, href: id ? contactHref(id) : undefined };
      r.cells[bucket(d)] = (r.cells[bucket(d)] as bigint) + L(d.balance);
      r.cells.balance = (r.cells.balance as bigint) + L(d.balance);
      by.set(id, r);
    }
    const rows = [...by.values()].sort((a, b) => String(a.cells.label).localeCompare(String(b.cells.label)));
    rows.push(sumRow(rows, [...keys, "balance"]));
    return { title, subtitle: `As at ${date(p.today)}`, columns: [text("label", "Name"), ...BUCKETS.map(([k, l]) => money(k, l)), money("balance", "Total")], rows };
  };
}

/** Income or cost lines in the range grouped by contact or project. */
function byDimension(title: string, dim: "contact" | "project", types: string[], sign: 1n | -1n): ReportDef["build"] {
  return async (s, p) => {
    const [{ data }, { data: accts }] = await Promise.all([
      s.supabase.rpc("report_by", { p_from: p.range.from, p_to: p.range.to, p_dim: dim }),
      s.supabase.from("accounts").select("id, type"),
    ]);
    const type = new Map((accts ?? []).map((a) => [a.id, a.type as string]));
    const totals = new Map<string, bigint>();
    for (const r of (data ?? []) as { dim_id: string | null; account_id: string; amount: number }[]) {
      if (!types.includes(type.get(r.account_id) ?? "")) continue;
      totals.set(r.dim_id ?? "", (totals.get(r.dim_id ?? "") ?? 0n) + L(r.amount) * sign);
    }
    const nm = await names(s, dim === "contact" ? "contacts" : "projects", [...totals.keys()].filter(Boolean));
    const grand = [...totals.values()].reduce((t, v) => t + v, 0n);
    const rows: Row[] = [...totals.entries()].filter(([, v]) => v !== 0n).sort((a, b) => Number(b[1] - a[1])).map(([id, v]) => ({
      cells: { label: id ? nm.get(id) ?? "—" : dim === "contact" ? "No name" : "No project", amount: v, pct: grand ? Number((v * 10000n) / grand) / 100 : null },
      href: id ? (dim === "project" ? `/projects/${id}` : `/reports/profit-loss?preset=custom&from=${p.range.from}&to=${p.range.to}`) : undefined,
    }));
    rows.push({ ...sumRow(rows, ["amount"]), cells: { ...sumRow(rows, ["amount"]).cells, pct: 100 } });
    return { title, subtitle: rangeLabel(p.range), columns: [text("label", dim === "contact" ? "Name" : "Project"), money("amount", "Amount"), { key: "pct", label: "% of total", kind: "pct" }], rows };
  };
}

async function payslips(s: Session, p: Params) {
  const { data } = await s.supabase.from("payslips")
    .select("id, employee_id, gross, deductions, employer_contributions, net, employees(name, nationality_type, passport_no, permit_no), payroll_runs!inner(period_month, status), payslip_lines(amount, pay_items(code, name))")
    .gte("payroll_runs.period_month", p.range.from.slice(0, 8) + "01").lte("payroll_runs.period_month", p.range.to)
    .in("payroll_runs.status", ["approved", "posted"]);
  type P = { id: string; employee_id: string; gross: number; deductions: number; employer_contributions: number; net: number;
    employees: { name: string; nationality_type: string; passport_no: string | null; permit_no: string | null } | null;
    payroll_runs: { period_month: string; status: string }; payslip_lines: { amount: number; pay_items: { code: string; name: string } | null }[] };
  return ((data ?? []) as unknown as P[]).sort((a, b) => a.payroll_runs.period_month.localeCompare(b.payroll_runs.period_month) || (a.employees?.name ?? "").localeCompare(b.employees?.name ?? ""));
}
const month = (d: string) => { const [y, m] = d.split("-").map(Number); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`; };

function schedule(title: string, codes: string[][], labels: string[]): ReportDef["build"] {
  return async (s, p) => {
    const slips = await payslips(s, p);
    const rows: Row[] = [];
    for (const sl of slips) {
      const cells: Row["cells"] = { month: month(sl.payroll_runs.period_month), label: sl.employees?.name ?? "—", id: sl.employees?.passport_no ?? sl.employees?.permit_no ?? "", gross: L(sl.gross) };
      let any = false;
      codes.forEach((cs, i) => {
        const v = sl.payslip_lines.filter((l) => cs.includes(l.pay_items?.code ?? "")).reduce((t, l) => t + L(l.amount), 0n);
        cells[`c${i}`] = v; if (v) any = true;
      });
      if (any || codes.length) rows.push({ cells, href: `/payroll/employees/${sl.employee_id}` });
    }
    const keys = codes.map((_, i) => `c${i}`);
    rows.push(sumRow(rows, ["gross", ...keys]));
    return { title, subtitle: rangeLabel(p.range), columns: [text("month", "Month"), text("label", "Employee"), text("id", "ID / permit"), money("gross", "Gross"),
      ...labels.map((l, i) => money(`c${i}`, l))], rows };
  };
}

export const lists: ReportDef[] = [
  // ── projects ──
  {
    key: "project-summary", title: "Project Value Summary", group: "Projects", filters: [],
    description: "Contract, variations, revised value, billed, collected, cost, forecast profit, margin and % complete for every project",
    async build(s, p) {
      const { data } = await s.supabase.from("project_list_v").select("*").is("archived_at", null).order("code");
      type P = { id: string; code: string; name: string; stage: string; original: number; variations: number; revised: number; billed: number; collected: number;
        cost_to_date: number; forecast_profit: number; margin_pct: number; pct_complete: number };
      const rows: Row[] = ((data ?? []) as P[]).map((x) => ({
        cells: { label: `${x.code} ${x.name}`, stage: titleize(x.stage), original: L(x.original), variations: L(x.variations), revised: L(x.revised), billed: L(x.billed),
          collected: L(x.collected), cost: L(x.cost_to_date), profit: L(x.forecast_profit), margin: Number(x.margin_pct), complete: Number(x.pct_complete) },
        href: `/projects/${x.id}`,
      }));
      rows.push(sumRow(rows, ["original", "variations", "revised", "billed", "collected", "cost", "profit"]));
      return { title: "Project Value Summary", subtitle: `As at ${date(p.today)}`, columns: [text("label", "Project"), text("stage", "Stage"),
        money("original", "Contract"), money("variations", "Variations"), money("revised", "Revised value"), money("billed", "Billed"), money("collected", "Collected"),
        money("cost", "Cost"), money("profit", "Forecast profit"), { key: "margin", label: "Margin %", kind: "pct" }, { key: "complete", label: "% complete", kind: "pct" }], rows };
    },
  },
  {
    key: "wip", title: "WIP / Over-Under Billing", group: "Projects", filters: [],
    description: "Earned against billed for each active project: billed ahead of work is a liability, work ahead of billing an asset",
    async build(s) {
      const { data } = await s.supabase.from("project_list_v").select("id, code, name, completed_at, revised, pct_complete, earned, billed, over_under_billing, cost_to_date").is("archived_at", null).is("completed_at", null).order("code");
      const rows: Row[] = ((data ?? []) as { id: string; code: string; name: string; revised: number; pct_complete: number; earned: number; billed: number; over_under_billing: number; cost_to_date: number }[]).map((x) => {
        const o = L(x.over_under_billing);
        return { cells: { label: `${x.code} ${x.name}`, revised: L(x.revised), cost: L(x.cost_to_date), complete: Number(x.pct_complete), earned: L(x.earned), billed: L(x.billed),
          over: o > 0n ? o : 0n, under: o < 0n ? -o : 0n }, href: `/projects/${x.id}` };
      });
      rows.push(sumRow(rows, ["revised", "cost", "earned", "billed", "over", "under"]));
      return { title: "WIP / Over-Under Billing", columns: [text("label", "Project"), money("revised", "Contract"), money("cost", "Cost to date"), { key: "complete", label: "% complete", kind: "pct" },
        money("earned", "Earned"), money("billed", "Billed"), money("over", "Billed ahead"), money("under", "Work ahead")], rows };
    },
  },
  {
    key: "cost-by-category", title: "Cost by Category", group: "Projects", filters: ["range"],
    description: "Job costs for each project by budget category (materials, subcontractors, labour …)",
    async build(s, p) {
      const [{ data }, { data: accts }] = await Promise.all([
        s.supabase.rpc("report_by", { p_from: p.range.from, p_to: p.range.to, p_dim: "project" }),
        s.supabase.from("accounts").select("id, parent_id, type, budget_category"),
      ]);
      const meta = new Map((accts ?? []).map((a) => [a.id, a]));
      const cat = (id: string) => { const a = meta.get(id); const par = a?.parent_id ? meta.get(a.parent_id) : null; return a?.type === "cogs" ? (a.budget_category ?? par?.budget_category ?? "other") : null; };
      const cats = ["materials", "subcontractors", "labour", "equipment", "freight", "site", "other"];
      const by = new Map<string, Record<string, bigint>>();
      for (const r of (data ?? []) as { dim_id: string | null; account_id: string; amount: number }[]) {
        const c = cat(r.account_id); if (!c) continue;
        const row = by.get(r.dim_id ?? "") ?? {};
        row[c] = (row[c] ?? 0n) - L(r.amount);
        by.set(r.dim_id ?? "", row);
      }
      const nm = await names(s, "projects", [...by.keys()].filter(Boolean));
      const rows: Row[] = [...by.entries()].map(([id, v]) => ({
        cells: { label: id ? nm.get(id) ?? "—" : "No project", ...Object.fromEntries(cats.map((c) => [c, v[c] ?? 0n])), total: Object.values(v).reduce((t, x) => t + x, 0n) },
        href: id ? `/projects/${id}?tab=value` : undefined,
      })).sort((a, b) => String(a.cells.label).localeCompare(String(b.cells.label)));
      rows.push(sumRow(rows, [...cats, "total"]));
      return { title: "Cost by Category", subtitle: rangeLabel(p.range), columns: [text("label", "Project"), ...cats.map((c) => money(c, titleize(c))), money("total", "Total")], rows };
    },
  },
  {
    key: "labour-by-project", title: "Labour Cost by Project", group: "Projects", filters: ["range"], payroll: true,
    description: "Site labour from approved payroll runs, allocated to projects, by employee and month",
    async build(s, p) {
      const { data } = await s.supabase.from("labour_allocations")
        .select("project_id, amount, payslips!inner(employee_id, employees(name), payroll_runs!inner(period_month, status))")
        .gte("payslips.payroll_runs.period_month", p.range.from.slice(0, 8) + "01").lte("payslips.payroll_runs.period_month", p.range.to)
        .in("payslips.payroll_runs.status", ["approved", "posted"]);
      type A = { project_id: string | null; amount: number; payslips: { employee_id: string; employees: { name: string } | null; payroll_runs: { period_month: string } } };
      const list = (data ?? []) as unknown as A[];
      const nm = await names(s, "projects", [...new Set(list.map((a) => a.project_id).filter(Boolean))] as string[]);
      const rows: Row[] = list.sort((a, b) => (nm.get(a.project_id ?? "") ?? "~").localeCompare(nm.get(b.project_id ?? "") ?? "~") || a.payslips.payroll_runs.period_month.localeCompare(b.payslips.payroll_runs.period_month))
        .map((a) => ({ cells: { label: a.project_id ? nm.get(a.project_id) ?? "—" : "Overhead", month: month(a.payslips.payroll_runs.period_month), employee: a.payslips.employees?.name ?? "—", amount: L(a.amount) },
          href: a.project_id ? `/projects/${a.project_id}` : undefined }));
      rows.push(sumRow(rows, ["amount"]));
      return { title: "Labour Cost by Project", subtitle: rangeLabel(p.range), columns: [text("label", "Project"), text("month", "Month"), text("employee", "Employee"), money("amount", "Cost")], rows };
    },
  },
  {
    key: "variations", title: "Variations Register", group: "Projects", filters: [],
    description: "Every variation on every project, with status and amount",
    async build(s) {
      const { data } = await s.supabase.from("variations").select("id, project_id, ref, title, status, amount, raised_date, approved_date, time_impact_days, projects(code, name)").order("raised_date");
      type V = { project_id: string; ref: string | null; title: string; status: string; amount: number; raised_date: string | null; approved_date: string | null; time_impact_days: number | null; projects: { code: string; name: string } | null };
      const rows: Row[] = ((data ?? []) as unknown as V[]).map((v) => ({
        cells: { label: `${v.projects?.code ?? ""} ${v.projects?.name ?? ""}`, ref: v.ref ?? "", title: v.title, status: titleize(v.status), raised: v.raised_date, approved: v.approved_date,
          days: v.time_impact_days, amount: L(v.amount), approvedAmt: v.status === "approved" ? L(v.amount) : 0n },
        href: `/projects/${v.project_id}?tab=variations`,
      }));
      rows.push(sumRow(rows, ["amount", "approvedAmt"]));
      return { title: "Variations Register", columns: [text("label", "Project"), text("ref", "Ref"), text("title", "Title"), text("status", "Status"), { key: "raised", label: "Raised", kind: "date" },
        { key: "approved", label: "Approved", kind: "date" }, { key: "days", label: "Days", kind: "num" }, money("amount", "Amount"), money("approvedAmt", "Approved amount")], rows };
    },
  },

  // ── sales and receivables ──
  { key: "ar-aging", title: "AR Aging Summary", group: "Sales and receivables", filters: [], description: "What each customer owes, by how overdue",
    build: aging("AR Aging Summary", ["invoice"], false, (id) => `/sales/customers/${id}`) },
  { key: "ar-aging-detail", title: "AR Aging Detail / Open Invoices", group: "Sales and receivables", filters: [], description: "Every unpaid invoice with its due date and days overdue",
    build: aging("AR Aging Detail", ["invoice"], true, (id) => `/sales/customers/${id}`) },
  {
    key: "customer-balances", title: "Customer Balances", group: "Sales and receivables", filters: [], description: "Each customer's balance, overdue part and open documents",
    async build(s) {
      const { data } = await s.supabase.from("contact_balances_v").select("contact_id, receivable, overdue_receivable, documents").neq("receivable", 0);
      const list = (data ?? []) as { contact_id: string; receivable: number; overdue_receivable: number; documents: number }[];
      const nm = await names(s, "contacts", list.map((x) => x.contact_id));
      const rows: Row[] = list.map((x) => ({ cells: { label: nm.get(x.contact_id) ?? "—", docs: x.documents, balance: L(x.receivable), overdue: L(x.overdue_receivable) }, href: `/sales/customers/${x.contact_id}` }))
        .sort((a, b) => String(a.cells.label).localeCompare(String(b.cells.label)));
      rows.push(sumRow(rows, ["balance", "overdue"]));
      return { title: "Customer Balances", columns: [text("label", "Customer"), { key: "docs", label: "Open documents", kind: "num" }, money("balance", "Balance"), money("overdue", "Overdue")], rows };
    },
  },
  {
    key: "collections", title: "Collections", group: "Sales and receivables", filters: ["range"], description: "Money received from customers in the period",
    async build(s, p) {
      const { data } = await s.supabase.from("transactions").select("id, type, date, number, reference, total_amount, contacts(name)")
        .in("type", ["customer_payment", "sales_receipt", "customer_advance"]).eq("is_draft", false).is("voided_at", null)
        .gte("date", p.range.from).lte("date", p.range.to).order("date");
      const { data: receipts } = await s.supabase.from("document_balances_v").select("id, total").eq("type", "sales_receipt").gte("date", p.range.from).lte("date", p.range.to);
      const rt = new Map((receipts ?? []).map((r) => [r.id, r.total]));
      const rows: Row[] = ((data ?? []) as unknown as { id: string; type: string; date: string; number: string | null; reference: string | null; total_amount: number | null; contacts: { name: string } | null }[])
        .map((t) => ({ cells: { date: t.date, label: t.contacts?.name ?? "—", doc: `${titleize(t.type)} ${t.number ?? ""}`, ref: t.reference ?? "", amount: L(t.total_amount ?? rt.get(t.id)) }, href: txnHref(t.type, t.id) }));
      rows.push(sumRow(rows, ["amount"], "Total", "date"));
      return { title: "Collections", subtitle: rangeLabel(p.range), columns: [{ key: "date", label: "Date", kind: "date" }, text("label", "Customer"), text("doc", "Document"), text("ref", "Reference"), money("amount", "Amount")], rows };
    },
  },
  { key: "sales-by-customer", title: "Sales by Customer", group: "Sales and receivables", filters: ["range"], description: "Revenue in the period by customer",
    build: byDimension("Sales by Customer", "contact", ["income"], 1n) },
  { key: "sales-by-project", title: "Sales by Project", group: "Sales and receivables", filters: ["range"], description: "Revenue in the period by project",
    build: byDimension("Sales by Project", "project", ["income"], 1n) },

  // ── expenses and payables ──
  { key: "ap-aging", title: "AP Aging Summary", group: "Expenses and payables", filters: [], description: "What is owed to each vendor, by how overdue",
    build: aging("AP Aging Summary", ["bill"], false, (id) => `/expenses/vendors/${id}`) },
  { key: "unpaid-bills", title: "Unpaid Bills", group: "Expenses and payables", filters: [], description: "Every unpaid bill with its due date and days overdue",
    build: aging("Unpaid Bills", ["bill"], true, (id) => `/expenses/vendors/${id}`) },
  {
    key: "vendor-balances", title: "Vendor Balances", group: "Expenses and payables", filters: [], description: "What is owed to each vendor and how much is overdue",
    async build(s) {
      const { data } = await s.supabase.from("contact_balances_v").select("contact_id, payable, overdue_payable, documents").neq("payable", 0);
      const list = (data ?? []) as { contact_id: string; payable: number; overdue_payable: number; documents: number }[];
      const nm = await names(s, "contacts", list.map((x) => x.contact_id));
      const rows: Row[] = list.map((x) => ({ cells: { label: nm.get(x.contact_id) ?? "—", docs: x.documents, balance: L(x.payable), overdue: L(x.overdue_payable) }, href: `/expenses/vendors/${x.contact_id}` }))
        .sort((a, b) => String(a.cells.label).localeCompare(String(b.cells.label)));
      rows.push(sumRow(rows, ["balance", "overdue"]));
      return { title: "Vendor Balances", columns: [text("label", "Vendor"), { key: "docs", label: "Open documents", kind: "num" }, money("balance", "Balance"), money("overdue", "Overdue")], rows };
    },
  },
  {
    key: "expenses-by-category", title: "Expenses by Category", group: "Expenses and payables", filters: ["range", "project"], description: "Cost of sales and expenses in the period by account",
    async build(s, p) {
      const accts = (await tb(s, p.range, { project: p.project })).filter((a) => (a.type === "cogs" || a.type === "expense") && a.debit - a.credit !== 0n);
      const grand = accts.reduce((t, a) => t + a.debit - a.credit, 0n);
      const rows: Row[] = accts.map((a) => ({ cells: { label: `${a.code} ${a.name}`, kind: a.type === "cogs" ? "Cost of sales" : "Expense", amount: a.debit - a.credit,
        pct: grand ? Number(((a.debit - a.credit) * 10000n) / grand) / 100 : null }, href: glHref(a.id, p.range, { project: p.project }) }));
      rows.push(sumRow(rows, ["amount"]));
      return { title: "Expenses by Category", subtitle: rangeLabel(p.range), columns: [text("label", "Account"), text("kind", "Kind"), money("amount", "Amount"), { key: "pct", label: "% of total", kind: "pct" }], rows };
    },
  },
  { key: "expenses-by-vendor", title: "Expenses by Vendor", group: "Expenses and payables", filters: ["range"], description: "Costs in the period by vendor",
    build: byDimension("Expenses by Vendor", "contact", ["cogs", "expense"], -1n) },
  { key: "expenses-by-project", title: "Expenses by Project", group: "Expenses and payables", filters: ["range"], description: "Costs in the period by project",
    build: byDimension("Expenses by Project", "project", ["cogs", "expense"], -1n) },

  // ── payroll ──
  {
    key: "payroll-summary", title: "Payroll Summary by Month", group: "Payroll", filters: ["range"], payroll: true, description: "Gross, deductions, employer contributions and net pay for each run",
    async build(s, p) {
      const slips = await payslips(s, p);
      const by = new Map<string, Row>();
      for (const sl of slips) {
        const k = sl.payroll_runs.period_month;
        const r = by.get(k) ?? { cells: { label: month(k), people: 0, gross: 0n, deductions: 0n, employer: 0n, net: 0n, cost: 0n } };
        r.cells.people = (r.cells.people as number) + 1;
        for (const [c, v] of [["gross", sl.gross], ["deductions", sl.deductions], ["employer", sl.employer_contributions], ["net", sl.net]] as const) r.cells[c] = (r.cells[c] as bigint) + L(v);
        r.cells.cost = (r.cells.gross as bigint) + (r.cells.employer as bigint);
        by.set(k, r);
      }
      const rows = [...by.values()];
      rows.push(sumRow(rows, ["gross", "deductions", "employer", "net", "cost"]));
      return { title: "Payroll Summary by Month", subtitle: rangeLabel(p.range), columns: [text("label", "Month"), { key: "people", label: "Payslips", kind: "num" }, money("gross", "Gross"),
        money("deductions", "Deductions"), money("net", "Net pay"), money("employer", "Employer contributions"), money("cost", "Total cost")], rows };
    },
  },
  {
    key: "payroll-by-employee", title: "Payroll by Employee", group: "Payroll", filters: ["range"], payroll: true, description: "Each employee's gross, deductions and net for the period (annual by default)",
    async build(s, p) {
      const slips = await payslips(s, p);
      const by = new Map<string, Row>();
      for (const sl of slips) {
        const r = by.get(sl.employee_id) ?? { cells: { label: sl.employees?.name ?? "—", months: 0, gross: 0n, deductions: 0n, net: 0n, employer: 0n }, href: `/payroll/employees/${sl.employee_id}` };
        r.cells.months = (r.cells.months as number) + 1;
        for (const [c, v] of [["gross", sl.gross], ["deductions", sl.deductions], ["employer", sl.employer_contributions], ["net", sl.net]] as const) r.cells[c] = (r.cells[c] as bigint) + L(v);
        by.set(sl.employee_id, r);
      }
      const rows = [...by.values()].sort((a, b) => String(a.cells.label).localeCompare(String(b.cells.label)));
      rows.push(sumRow(rows, ["gross", "deductions", "net", "employer"]));
      return { title: "Payroll by Employee", subtitle: rangeLabel(p.range), columns: [text("label", "Employee"), { key: "months", label: "Months", kind: "num" }, money("gross", "Gross"),
        money("deductions", "Deductions"), money("net", "Net pay"), money("employer", "Employer contributions")], rows };
    },
  },
  { key: "pension-schedule", title: "Pension Schedule", group: "Payroll", filters: ["range"], payroll: true, description: "Employee and employer pension per employee per month",
    build: schedule("Pension Schedule", [["PENSION_EE"], ["PENSION_ER"]], ["Employee", "Employer"]) },
  { key: "wht-schedule", title: "Withholding-Tax Schedule", group: "Payroll", filters: ["range"], payroll: true, description: "Tax withheld per employee per month",
    build: schedule("Withholding-Tax Schedule", [["WHT"]], ["Withholding tax"]) },
  {
    key: "staff-advances", title: "Staff Advances", group: "Payroll", filters: [], payroll: true, description: "Advances outstanding per employee",
    async build(s, p) {
      const { data: acct } = await s.supabase.from("accounts").select("id").eq("subtype", "staff_advances").maybeSingle();
      const { data } = acct ? await s.supabase.from("journal_lines").select("employee_id, home_debit, home_credit").eq("account_id", acct.id).lte("date", p.today) : { data: [] };
      const by = new Map<string, { adv: bigint; rec: bigint }>();
      for (const l of (data ?? []) as { employee_id: string | null; home_debit: number; home_credit: number }[]) {
        const r = by.get(l.employee_id ?? "") ?? { adv: 0n, rec: 0n };
        r.adv += L(l.home_debit); r.rec += L(l.home_credit); by.set(l.employee_id ?? "", r);
      }
      const nm = await names(s, "employees", [...by.keys()].filter(Boolean));
      const rows: Row[] = [...by.entries()].map(([id, v]) => ({ cells: { label: nm.get(id) ?? "—", adv: v.adv, rec: v.rec, balance: v.adv - v.rec }, href: id ? `/payroll/employees/${id}` : undefined }))
        .sort((a, b) => String(a.cells.label).localeCompare(String(b.cells.label)));
      rows.push(sumRow(rows, ["adv", "rec", "balance"]));
      return { title: "Staff Advances", subtitle: `As at ${date(p.today)}`, columns: [text("label", "Employee"), money("adv", "Advanced"), money("rec", "Recovered"), money("balance", "Outstanding")], rows };
    },
  },
  {
    key: "payroll-costs", title: "Payroll Costs (note)", group: "Notes to the statements", filters: ["range"], payroll: true, description: "Salaries, labour and pension charged in the period, by account",
    async build(s, p) {
      const SUBS = ["direct_labour", "admin_salaries", "employer_pension", "staff_allowances", "work_permits", "staff_insurance", "staff_accommodation"];
      const accts = (await tb(s, p.range)).filter((a) => SUBS.includes(a.subtype ?? "") && a.debit - a.credit !== 0n);
      const rows: Row[] = accts.map((a) => ({ cells: { label: `${a.code} ${a.name}`, amount: a.debit - a.credit }, href: glHref(a.id, p.range) }));
      rows.push(sumRow(rows, ["amount"]));
      return { title: "Payroll Costs", subtitle: rangeLabel(p.range), columns: [text("label", "Account"), money("amount", "Amount")], rows };
    },
  },

  // ── tax ──
  {
    key: "gst-control", title: "GST Control Reconciliation", group: "Tax", filters: [], description: "GST accounts in the ledger against the returns: open, filed but unpaid, credit carried",
    async build(s) {
      const [{ data: periods }, { data: accts }, { data: bals }] = await Promise.all([
        s.supabase.from("gst_periods_v").select("*").order("start_date"),
        s.supabase.from("accounts").select("id, code, name, subtype").in("subtype", ["gst_output", "gst_input", "gst_payable", "gst_refund"]),
        s.supabase.rpc("rpc_account_balances", {}),
      ]);
      type P = { id: string; start_date: string; end_date: string; status: string; output: number; input: number; net: number; payable: number };
      const ps = (periods ?? []) as P[];
      const bal = new Map(((bals ?? []) as { account_id: string; balance: number }[]).map((b) => [b.account_id, L(b.balance)]));
      const acct = (st: string) => (accts ?? []).find((a) => a.subtype === st);
      const gl = (st: string) => { const a = acct(st); return a ? bal.get(a.id) ?? 0n : 0n; };
      const open = ps.filter((x) => x.status === "open");
      const line = (label: string, st: string, returns: bigint, note: string): Row => {
        const ledger = gl(st);
        const a = acct(st);
        return { cells: { label, ledger, returns, diff: ledger - returns, note }, href: a ? glHref(a.id, { from: "2000-01-01", to: new Date().toISOString().slice(0, 10) }) : undefined };
      };
      const rows: Row[] = [
        line("GST output tax payable", "gst_output", open.reduce((t, x) => t + L(x.output), 0n), `open returns: ${open.map((x) => periodLabel(x.start_date, x.end_date)).join(", ") || "none"}`),
        line("GST input tax receivable", "gst_input", open.reduce((t, x) => t + L(x.input), 0n), "open returns"),
        line("GST payable – MIRA", "gst_payable", ps.filter((x) => x.status === "filed").reduce((t, x) => t + L(x.payable), 0n), "filed, not yet paid"),
        { cells: { label: "GST refund / carried forward", ledger: gl("gst_refund"), note: "credit to use against the next return that owes" } },
      ];
      rows.push({ cells: { label: "Returns" }, style: "section" });
      for (const x of ps) rows.push({ cells: { label: periodLabel(x.start_date, x.end_date), ledger: L(x.output), returns: L(x.input), diff: L(x.net), note: titleize(x.status) }, href: `/taxes/gst/${x.id}`, style: "indent" });
      return { title: "GST Control Reconciliation", subtitle: "Each difference should be 0",
        columns: [text("label", ""), money("ledger", "Ledger / output"), money("returns", "Returns / input"), money("diff", "Difference / net"), text("note", "")], rows };
    },
  },
  {
    key: "gst-history", title: "GST Filing History", group: "Tax", filters: [], description: "Every return: when filed, the MIRA reference, net and what is still owed",
    async build(s) {
      const { data } = await s.supabase.from("gst_periods_v").select("*").order("start_date", { ascending: false });
      const rows: Row[] = ((data ?? []) as { id: string; start_date: string; end_date: string; due_date: string; status: string; return_reference: string | null; filed_at: string | null; net: number; payable: number }[])
        .map((x) => ({ cells: { label: periodLabel(x.start_date, x.end_date), status: titleize(x.status), due: x.due_date, filed: x.filed_at?.slice(0, 10) ?? null, ref: x.return_reference ?? "",
          net: L(x.net), owed: x.status === "open" ? null : L(x.payable) }, href: `/taxes/gst/${x.id}` }));
      return { title: "GST Filing History", columns: [text("label", "Period"), text("status", "Status"), { key: "due", label: "Due", kind: "date" }, { key: "filed", label: "Filed", kind: "date" },
        text("ref", "MIRA reference"), money("net", "Net"), money("owed", "Still owed")], rows };
    },
  },
  {
    key: "bpt", title: "Business Profit Tax (note)", group: "Notes to the statements", filters: ["range"], description: "Accounting profit for the year and the tax by the rate brackets in Settings",
    async build(s, p) {
      const accts = await tb(s, p.range);
      const bptExp = accts.filter((a) => a.subtype === "income_tax" || a.subtype === "bpt").reduce((t, a) => t + a.debit - a.credit, 0n);
      const before = profitOf(accts) + bptExp;
      const { data: brackets } = await s.supabase.rpc("rate_brackets", { p_kind: "bpt", p_code: "default", p_date: p.range.to });
      const bs = (brackets ?? []) as { from: number; to: number | null; rate: number }[];
      const rows: Row[] = [{ cells: { label: "Profit before tax", amount: before }, style: "subtotal" }];
      let tax = 0n;
      for (const b of bs) {
        const lo = L(b.from), hi = b.to == null ? null : L(b.to);
        const slice = before <= lo ? 0n : (hi === null || before < hi ? before : hi) - lo;
        const t = (slice * BigInt(Math.round(Number(b.rate) * 10000))) / 1000000n;
        tax += t;
        rows.push({ cells: { label: `${hi === null ? `Above ${lo / 100n}` : `${lo / 100n} – ${hi / 100n}`} at ${Number(b.rate)}%`, base: slice, amount: t }, style: "indent" });
      }
      rows.push({ cells: { label: "Business profit tax (estimate)", amount: tax }, style: "total" });
      rows.push({ cells: { label: "Tax charged in the ledger so far", amount: bptExp } });
      return { title: "Business Profit Tax", subtitle: rangeLabel(p.range), columns: [text("label", ""), money("base", "Taxable"), money("amount", "Amount")], rows,
        notes: [bs.length ? "No adjustments for non-deductible items are made; the provision is posted after review (decision F3)." : "No BPT rate brackets are set in Settings → Taxes & rates."] };
    },
  },

  // ── partners and financing ──
  {
    key: "financing-summary", title: "Financing Summary", group: "Partners and financing", filters: [], description: "Each project's financing, principal and returns owed, and payout status",
    async build(s) {
      const { data } = await s.supabase.from("project_payouts_v").select("*").order("code");
      const rows: Row[] = ((data ?? []) as { id: string; code: string; name: string; stage: string; financed: number; principal_outstanding: number; returns_outstanding: number; split_profit: number | null; blocked: boolean; blocked_reason: string | null }[])
        .filter((x) => L(x.financed) || L(x.returns_outstanding) || x.split_profit != null)
        .map((x) => ({ cells: { label: `${x.code} ${x.name}`, stage: titleize(x.stage), financed: L(x.financed), principal: L(x.principal_outstanding), returns: L(x.returns_outstanding),
          profit: x.split_profit == null ? null : L(x.split_profit), status: x.blocked ? x.blocked_reason ?? "Blocked" : "Released" }, href: `/projects/${x.id}?tab=financing` }));
      rows.push(sumRow(rows, ["financed", "principal", "returns"]));
      return { title: "Financing Summary", columns: [text("label", "Project"), text("stage", "Stage"), money("financed", "Financed"), money("principal", "Principal owed"),
        money("returns", "Returns owed"), money("profit", "Split on profit"), text("status", "Payouts")], rows };
    },
  },
  {
    key: "payouts-pending", title: "Payouts Pending / Blocked", group: "Partners and financing", filters: [], description: "What is owed to each person on each project, and whether it can be paid",
    async build(s) {
      const [{ data: st }, { data: proj }] = await Promise.all([
        s.supabase.from("partner_statement_v").select("contact_id, project_id, component, outstanding").gt("outstanding", 0),
        s.supabase.from("project_payouts_v").select("id, code, blocked, blocked_reason"),
      ]);
      const pm = new Map((proj ?? []).map((x) => [x.id, x]));
      const list = (st ?? []) as { contact_id: string; project_id: string; component: string; outstanding: number }[];
      const nm = await names(s, "contacts", [...new Set(list.map((x) => x.contact_id))]);
      const rows: Row[] = list.map((x) => ({ cells: { label: nm.get(x.contact_id) ?? "—", project: pm.get(x.project_id)?.code ?? "—", component: titleize(x.component), owed: L(x.outstanding),
        status: pm.get(x.project_id)?.blocked ? pm.get(x.project_id)?.blocked_reason ?? "Blocked" : "Ready to pay" }, href: `/partners/${x.contact_id}` }))
        .sort((a, b) => String(a.cells.label).localeCompare(String(b.cells.label)) || String(a.cells.project).localeCompare(String(b.cells.project)));
      rows.push(sumRow(rows, ["owed"]));
      return { title: "Payouts Pending / Blocked", columns: [text("label", "Person"), text("project", "Project"), text("component", "Component"), money("owed", "Owed"), text("status", "Status")], rows };
    },
  },
  {
    key: "loans", title: "Loans (note)", group: "Notes to the statements", filters: ["asAt"], description: "External and Capital Pool loans by lender and project: received, repaid, outstanding",
    async build(s) {
      const { data } = await s.supabase.from("project_financing_v").select("contact_id, project_id, source_type, received, repaid, outstanding");
      const list = (data ?? []) as { contact_id: string; project_id: string; source_type: string; received: number; repaid: number; outstanding: number }[];
      const [nm, pn] = await Promise.all([names(s, "contacts", [...new Set(list.map((x) => x.contact_id))]), names(s, "projects", [...new Set(list.map((x) => x.project_id))])]);
      const rows: Row[] = list.sort((a, b) => a.source_type.localeCompare(b.source_type) || (nm.get(a.contact_id) ?? "").localeCompare(nm.get(b.contact_id) ?? ""))
        .map((x) => ({ cells: { label: nm.get(x.contact_id) ?? "—", type: x.source_type === "external" ? "External lender" : "Capital Pool", project: pn.get(x.project_id) ?? "—",
          received: L(x.received), repaid: L(x.repaid), outstanding: L(x.outstanding) }, href: `/partners/${x.contact_id}` }));
      rows.push(sumRow(rows, ["received", "repaid", "outstanding"]));
      return { title: "Loans", columns: [text("label", "Lender"), text("type", "Type"), text("project", "Project"), money("received", "Received"), money("repaid", "Repaid"), money("outstanding", "Outstanding")], rows,
        notes: ["Capital Pool contributions are shareholder loans (liabilities), repaid once the project's client has paid in full."] };
    },
  },
  {
    key: "related-parties", title: "Related-Party Balances (note)", group: "Notes to the statements", filters: ["range"], description: "Shareholders and directors: loans, returns and shares owed, and what was paid in the period",
    async build(s, p) {
      const [{ data: partners }, { data: st }, { data: paid }] = await Promise.all([
        s.supabase.from("contacts").select("id, name").contains("kinds", ["partner"]).order("name"),
        s.supabase.from("partner_statement_v").select("contact_id, component, accrued, paid, outstanding"),
        s.supabase.from("transactions").select("contact_id, total_amount").eq("type", "payout").eq("is_draft", false).is("voided_at", null).gte("date", p.range.from).lte("date", p.range.to),
      ]);
      const list = (st ?? []) as { contact_id: string; component: string; outstanding: number }[];
      const rows: Row[] = (partners ?? []).map((c) => {
        const o = (comp: string) => list.filter((x) => x.contact_id === c.id && x.component === comp).reduce((t, x) => t + L(x.outstanding), 0n);
        return { cells: { label: c.name, loan: o("principal"), ret: o("financing_return"), share: o("profit_share"),
          paid: (paid ?? []).filter((x) => x.contact_id === c.id).reduce((t, x) => t + L(x.total_amount), 0n) }, href: `/partners/${c.id}` };
      });
      rows.push(sumRow(rows, ["loan", "ret", "share", "paid"]));
      return { title: "Related-Party Balances", subtitle: `Balances today · paid ${rangeLabel(p.range)}`, columns: [text("label", "Shareholder / director"), money("loan", "Loans owed"),
        money("ret", "Financing return owed"), money("share", "Profit share owed"), money("paid", "Paid in period")], rows };
    },
  },

  // ── banking and control ──
  {
    key: "cash-position", title: "Cash Position", group: "Banking and control", filters: [], description: "Cash today, what customers owe in the next 30 days, and bills and payroll due",
    async build(s, p) {
      const [{ data: accts }, { data: bals }, { data: docs }] = await Promise.all([
        s.supabase.from("accounts").select("id, code, name, subtype").in("subtype", ["bank", "cash", "undeposited", "salaries_payable", "pension_payable", "wht_payable", "gst_payable"]).order("code"),
        s.supabase.rpc("rpc_account_balances", {}),
        s.supabase.from("document_balances_v").select("type, due_date, balance").in("type", ["invoice", "bill"]).eq("is_draft", false).is("voided_at", null).neq("balance", 0),
      ]);
      const bal = new Map(((bals ?? []) as { account_id: string; balance: number }[]).map((b) => [b.account_id, L(b.balance)]));
      const in30 = new Date(Date.parse(p.today) + 30 * 86400000).toISOString().slice(0, 10);
      const due = (t: string) => ((docs ?? []) as { type: string; due_date: string | null; balance: number }[]).filter((d) => d.type === t && (d.due_date ?? p.today) <= in30).reduce((x, d) => x + L(d.balance), 0n);
      const cash = (accts ?? []).filter((a) => ["bank", "cash", "undeposited"].includes(a.subtype as string));
      const owe = (accts ?? []).filter((a) => !["bank", "cash", "undeposited"].includes(a.subtype as string));
      const rows: Row[] = [{ cells: { label: "Cash and bank" }, style: "section" }];
      for (const a of cash) rows.push({ cells: { label: `${a.code} ${a.name}`, amount: bal.get(a.id) ?? 0n }, href: `/banking/${a.id}`, style: "indent" });
      const cashTotal = cash.reduce((t, a) => t + (bal.get(a.id) ?? 0n), 0n);
      rows.push({ cells: { label: "Cash now", amount: cashTotal }, style: "subtotal" });
      rows.push({ cells: { label: "Customers owe, due within 30 days (incl. overdue)", amount: due("invoice") }, href: "/reports/ar-aging-detail" });
      rows.push({ cells: { label: "Bills due within 30 days (incl. overdue)", amount: -due("bill") }, href: "/reports/unpaid-bills" });
      for (const a of owe) { const v = bal.get(a.id) ?? 0n; if (v) rows.push({ cells: { label: a.name, amount: -v }, href: glHref(a.id, { from: "2000-01-01", to: p.today }) }); }
      rows.push({ cells: { label: "Expected position in 30 days", amount: rows.filter((r) => r.style !== "section" && r.style !== "indent" && r.style !== "subtotal" && typeof r.cells.amount === "bigint").reduce((t, r) => t + (r.cells.amount as bigint), cashTotal) }, style: "total" });
      return { title: "Cash Position", subtitle: `As at ${date(p.today)}`, columns: [text("label", ""), money("amount", "Amount")], rows };
    },
  },
  {
    key: "cash-forecast", title: "Cash-Flow Forecast (12 weeks)", group: "Banking and control", filters: [],
    description: "Expected receipts against bills, payroll, GST and payouts, week by week, with the running cash balance",
    async build(s, p) {
      const fc = await loadForecast(s, p.today);
      const kinds = Object.keys(FLOW_LABEL).filter((k) => fc.weeks.some((w) => w.byKind[k]));
      const rows: Row[] = [{ cells: { label: "Cash now", closing: fc.cash }, style: "muted" }];
      for (const w of fc.weeks) rows.push({ cells: { label: `${date(w.start)} – ${date(w.end)}`, ...Object.fromEntries(kinds.map((k) => [k, w.byKind[k] ?? 0n])),
        net: w.net, closing: w.closing }, style: w.closing < 0n ? "muted" : undefined });
      rows.push(sumRow(rows.slice(1), [...kinds, "net"]));
      return { title: "Cash-Flow Forecast", subtitle: `12 weeks from ${date(p.today)}`, columns: [text("label", "Week"), ...kinds.map((k) => money(k, FLOW_LABEL[k])),
        money("net", "Net"), money("closing", "Cash at week end")], rows, notes: fc.notes };
    },
  },
  {
    key: "audit-log", title: "Audit Log", group: "Banking and control", filters: ["range"], description: "Every change to records, with who and when",
    async build(s, p) {
      const { data } = await s.supabase.from("audit_log").select("id, at, user_id, table_name, record_id, action, changed")
        .gte("at", p.range.from).lte("at", `${p.range.to}T23:59:59.999Z`).order("at", { ascending: false }).limit(1000);
      const list = (data ?? []) as { id: number; at: string; user_id: string | null; table_name: string; record_id: string; action: string; changed: string[] | null }[];
      const { data: people } = await s.supabase.from("profiles").select("id, full_name").in("id", [...new Set(list.map((x) => x.user_id).filter(Boolean))] as string[]);
      const who = new Map((people ?? []).map((x) => [x.id, x.full_name as string]));
      const rows: Row[] = list.map((x) => ({ cells: { date: x.at.slice(0, 10), time: x.at.slice(11, 16), label: who.get(x.user_id ?? "") ?? "System", action: titleize(x.action),
        table: titleize(x.table_name), changed: (x.changed ?? []).join(", ") } }));
      return { title: "Audit Log", subtitle: rangeLabel(p.range), columns: [{ key: "date", label: "Date", kind: "date" }, text("time", "Time (UTC)"), text("label", "Who"), text("action", "Action"),
        text("table", "Record"), text("changed", "Fields changed")], rows, notes: list.length >= 1000 ? ["Only the latest 1,000 changes are listed; choose a shorter range."] : [] };
    },
  },
];

