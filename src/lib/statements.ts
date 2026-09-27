import type { Records } from "@/lib/accounting";

/**
 * Financial statements from the app's records, by way of a double-entry
 * journal: every bill, invoice, client payment, salary, capital movement and
 * profit share is posted as balanced debits and credits, so the balance sheet
 * always balances and the four statements agree with each other.
 *
 * - Revenue is earned when a project is completed (or paid, if no completion
 *   is recorded), or when an invoice is issued.
 * - A project's costs wait as work in progress and pass to cost of sales in
 *   step with the revenue earned on it.
 * - Bills not on a project are running costs; bills marked capital are
 *   equipment, written off evenly over its life.
 * - Profit shares are shares of profit, not costs: owed on completion, then
 *   paid out or kept in the business as a partner's capital.
 * - Business profit tax is an estimate from the rate and threshold set.
 */

export type Acct =
  | "cash" | "ar" | "wip" | "ppe" | "accdep"
  | "payables" | "gst" | "due" | "tax"
  | "share" | "capital" | "retained"
  | "revenue" | "cogs" | "admin" | "salaries" | "depreciation" | "finance" | "taxexp" | "approp";

export type Flow = "operating" | "investing" | "financing";

export interface Line {
  date: string;
  acct: Acct;
  /** debit positive, credit negative */
  amount: number;
  /** what it is analysed by in the notes: a project, category, supplier, partner */
  sub?: string;
  memo: string;
  /** for cash lines: which part of the cash flow statement */
  flow?: Flow;
  flowLabel?: string;
}

export interface StatementSettings {
  share_capital: number;
  share_capital_date: string | null;
  bpt_rate: number;
  bpt_threshold: number;
  asset_life_years: number;
  opening_cash: number;
  gst_registered: boolean;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const FINANCE = /bank|interest|finance|loan/i;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function buildJournal(r: Records, s: StatementSettings, until: string): Line[] {
  const L: Line[] = [];
  const post = (date: string, lines: [Acct, number, string | undefined, Flow?, string?][], memo: string) => {
    for (const [acct, amount, sub, flow, flowLabel] of lines) {
      if (Math.abs(amount) < 0.005) continue;
      L.push({ date, acct, amount: r2(amount), sub, memo, flow, flowLabel });
    }
  };
  const proj = new Map(r.projects.map((p) => [p.id, p]));
  const pname = (id: string | null | undefined) => {
    const p = id ? proj.get(id) : null;
    return p ? `${p.code} ${p.name}` : "Other";
  };
  const starts = [
    ...r.bills.map((b) => day(b.issue_date) ?? day(b.created_at)),
    ...r.salaries.map((x) => day(x.paid_on)),
    ...r.pool.map((x) => day(x.entry_date)),
  ].filter(Boolean).sort() as string[];
  const first = starts[0] ?? until;

  // what the company started with
  if (s.share_capital) post(s.share_capital_date ?? first, [["cash", s.share_capital, "Share capital", "financing", "Share capital introduced"], ["share", -s.share_capital, undefined]], "Share capital paid in");
  if (s.opening_cash) post(first, [["cash", s.opening_cash, "Opening funds", "financing", "Opening funds"], ["retained", -s.opening_cash, "Opening balance"]], "Opening cash");

  // bills: costs on a project wait in work in progress; the rest are running costs or equipment
  type ProjEvent = { date: string; kind: "cost"; amount: number; cat: string } | { date: string; kind: "revenue"; subtotal: number } | { date: string; kind: "complete" };
  const events = new Map<string, ProjEvent[]>();
  const push = (pid: string, e: ProjEvent) => events.set(pid, [...(events.get(pid) ?? []), e]);
  const ppe: { date: string; cost: number; what: string }[] = [];
  for (const b of r.bills) {
    if (b.status === "void" || b.status === "draft") continue;
    const date = day(b.issue_date) ?? day(b.created_at)!;
    const total = n(b.total);
    const vendor = (b.vendors as unknown as { name: string } | null)?.name ?? "Supplier";
    const cat = (b.cost_categories as unknown as { name: string } | null)?.name ?? "Uncategorised";
    const memo = `${vendor}${b.bill_no ? ` ${b.bill_no}` : ""}`;
    let debit: Acct;
    let flow: Flow = "operating";
    let sub = cat;
    if (b.expense_class === "capital") {
      debit = "ppe";
      flow = "investing";
      sub = b.description || vendor;
      ppe.push({ date, cost: total, what: sub });
    } else if (b.project_id) {
      debit = "wip";
      sub = b.project_id;
      push(b.project_id, { date, kind: "cost", amount: total, cat });
    } else if (FINANCE.test(cat)) {
      debit = "finance";
      flow = "financing";
    } else {
      debit = "admin";
    }
    post(date, [[debit, total, sub], ["payables", -total, vendor]], memo);
    const paid = b.status === "paid" ? total : Math.min(total, n(b.amount_paid));
    if (paid > 0) {
      post(date, [["payables", paid, vendor], ["cash", -paid, vendor, flow, flow === "investing" ? "Purchase of equipment" : flow === "financing" ? "Finance costs" : "Paid to suppliers"]], `${memo} paid`);
    }
  }

  // salaries, paid as they are recorded
  for (const x of r.salaries) {
    const date = day(x.paid_on) ?? day(x.month)!;
    const who = (x.people as unknown as { name: string } | null)?.name ?? "Staff";
    post(date, [["salaries", n(x.amount), who], ["cash", -n(x.amount), who, "operating", "Paid to staff"]], `Salary ${who}`);
  }

  // revenue: invoices where there are any, otherwise the project on completion
  const totals = new Map(r.invoiceTotals.map((t) => [t.invoice_id, t]));
  const invoiced = new Set<string>();
  for (const i of r.invoices) {
    if (i.status !== "sent" && i.status !== "paid") continue;
    const t = totals.get(i.id);
    const sub = n(t?.subtotal);
    const tax = n(t?.tax);
    const date = day(i.issue_date)!;
    if (i.project_id) {
      invoiced.add(i.project_id);
      push(i.project_id, { date, kind: "revenue", subtotal: sub });
    }
    post(date, [["ar", sub + tax, i.to_name ?? `Invoice ${i.number}`], ["revenue", -sub, i.project_id ?? `Invoice ${i.number}`], ["gst", -tax, "Output tax"]], `Invoice ${i.number}`);
    if (i.status === "paid") {
      const paidOn = day(i.paid_at) ?? date;
      post(paidOn, [["cash", sub + tax, i.to_name ?? undefined, "operating", "Received from customers"], ["ar", -(sub + tax), i.to_name ?? `Invoice ${i.number}`]], `Invoice ${i.number} paid`);
    }
  }
  const value = (id: string) => n(proj.get(id)?.contract_value) + r.variations.filter((v) => v.project_id === id && v.status === "approved").reduce((a, v) => a + n(v.cost_impact), 0);
  for (const p of r.projects) {
    if (invoiced.has(p.id)) {
      if (p.status === "completed" && day(p.completed_at)) push(p.id, { date: day(p.completed_at)!, kind: "complete" });
      continue;
    }
    const earned = day(p.completed_at) ?? day(p.payment_received_at);
    const v = value(p.id);
    if (earned) {
      post(earned, [["ar", v, pname(p.id)], ["revenue", -v, p.id]], `${p.code} completed`);
      push(p.id, { date: earned, kind: "revenue", subtotal: v });
      push(p.id, { date: earned, kind: "complete" });
    }
    const received = n(p.payment_received_amount);
    if (day(p.payment_received_at) && received) {
      const onAccount = earned ? Math.min(received, v) : 0;
      const extra = received - onAccount;
      post(day(p.payment_received_at)!, [
        ["cash", received, pname(p.id), "operating", "Received from customers"],
        ["ar", -onAccount, pname(p.id)],
        // paid above the contract: GST collected if registered, otherwise extra income
        s.gst_registered ? ["gst", -extra, "Output tax"] : ["revenue", -extra, p.id],
      ], `${p.code} paid`);
    }
  }

  // cost of sales follows revenue: a project's costs pass out of WIP as its revenue is earned
  for (const [pid, evs] of events) {
    const v = value(pid);
    const cats = new Map<string, number>();
    let costToDate = 0;
    let revenueToDate = 0;
    let complete = false;
    let moved = 0;
    const byCatMoved = new Map<string, number>();
    const sorted = [...evs].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "cost" ? -1 : 1));
    for (const e of sorted) {
      if (e.kind === "cost") {
        costToDate += e.amount;
        cats.set(e.cat, (cats.get(e.cat) ?? 0) + e.amount);
      } else if (e.kind === "revenue") revenueToDate += e.subtotal;
      else complete = true;
      const f = complete ? 1 : v > 0 ? Math.min(1, revenueToDate / v) : revenueToDate > 0 ? 1 : 0;
      const target = f * costToDate;
      const move = target - moved;
      if (move > 0.005) {
        // split across the categories the costs came from
        for (const [cat, amt] of cats) {
          const catTarget = f * amt;
          const m = catTarget - (byCatMoved.get(cat) ?? 0);
          if (m > 0.005) {
            post(e.date, [["cogs", m, cat], ["wip", -m, pid]], `Cost of ${pname(pid)}`);
            byCatMoved.set(cat, (byCatMoved.get(cat) ?? 0) + m);
          }
        }
        moved = target;
      }
    }
  }

  // the capital pool: money put in or drawn; profit kept as capital comes through the profit shares below
  const salaryPool = new Set(r.salaries.map((x) => x.pool_entry_id).filter(Boolean));
  const member = new Map(r.members.map((m) => [m.id, m.name]));
  for (const e of r.pool) {
    if (salaryPool.has(e.id) || e.origin === "salary" || e.origin === "payment_received") continue;
    const date = day(e.entry_date)!;
    const name = member.get(e.member_id) ?? "Partner";
    const a = n(e.amount);
    if (e.entry_type === "contribution") post(date, [["cash", a, name, "financing", "Capital introduced"], ["capital", -a, name]], "Capital introduced");
    else if (e.entry_type === "withdrawal") post(date, [["capital", -a, name], ["cash", a, name, "financing", "Drawings"]], "Drawings");
    else post(date, [["approp", a, name], ["capital", -a, name]], `Capital ${e.entry_type}`);
  }

  // profit shares: owed when a project completes, then paid out or kept as capital
  const investor = new Map(r.investors.map((i) => [i.id, i.name]));
  const repaid = new Set(r.repayments.map((x) => x.internal_entry_id).filter(Boolean));
  for (const e of r.internal) {
    const date = day(e.entry_date)!;
    const name = e.investor_id ? investor.get(e.investor_id) ?? e.share_name : e.share_name;
    const a = n(e.amount);
    if (e.entry_type === "accrual") post(date, [["approp", a, name], ["due", -a, name]], `Profit share — ${name}`);
    else if (e.entry_type === "settlement" && !repaid.has(e.id)) {
      if (e.pool_member_id) post(date, [["due", -a, name], ["capital", a, member.get(e.pool_member_id) ?? name]], `Profit share kept as capital — ${name}`);
      else post(date, [["due", -a, name], ["cash", a, name, "financing", "Profit shares paid"]], `Profit share paid — ${name}`);
    } else if (e.entry_type === "adjustment") post(date, [["approp", a, name], ["due", -a, name]], `Profit share adjusted — ${name}`);
  }
  for (const x of r.repayments) {
    const name = investor.get(x.investor_id) ?? "Investor";
    post(day(x.paid_on)!, [["due", n(x.amount), name], ["cash", -n(x.amount), name, "financing", "Profit shares paid"]], `Investor repayment — ${name}`);
  }

  // equipment written off evenly over its life, month by month
  const life = Math.max(1, s.asset_life_years) * 12;
  for (const a of ppe) {
    const monthly = a.cost / life;
    const d = new Date(`${a.date.slice(0, 7)}-01T00:00:00Z`);
    for (let k = 1; k <= life; k++) {
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 0)).toISOString().slice(0, 10);
      if (end > until) break;
      post(end, [["depreciation", monthly, a.what], ["accdep", -monthly, a.what]], `Depreciation — ${a.what}`);
    }
  }

  // business profit tax, estimated on each year's profit
  const years = new Set(L.map((l) => l.date.slice(0, 4)));
  for (const y of [...years].sort()) {
    const end = `${y}-12-31`;
    if (end > until) continue;
    const pbt = -L.filter((l) => l.date.slice(0, 4) === y && PL.includes(l.acct) && l.acct !== "taxexp").reduce((a, l) => a + l.amount, 0);
    const tax = (Math.max(0, pbt - s.bpt_threshold) * s.bpt_rate) / 100;
    if (tax > 0.005) post(end, [["taxexp", tax, y], ["tax", -tax, y]], `Business profit tax ${y} (estimate)`);
  }
  return L.sort((a, b) => a.date.localeCompare(b.date));
}

export const PL: Acct[] = ["revenue", "cogs", "admin", "salaries", "depreciation", "finance", "taxexp"];

const sumOf = (lines: Line[], acct: Acct | Acct[], sub?: string) => {
  const set = Array.isArray(acct) ? acct : [acct];
  return lines.filter((l) => set.includes(l.acct) && (sub === undefined || l.sub === sub)).reduce((a, l) => a + l.amount, 0);
};
const upTo = (L: Line[], date: string) => L.filter((l) => l.date <= date);
const within = (L: Line[], from: string, to: string) => L.filter((l) => l.date >= from && l.date <= to);
const bySub = (lines: Line[], acct: Acct | Acct[], sign = 1) => {
  const set = Array.isArray(acct) ? acct : [acct];
  const m = new Map<string, number>();
  for (const l of lines) if (set.includes(l.acct)) m.set(l.sub ?? "Other", (m.get(l.sub ?? "Other") ?? 0) + sign * l.amount);
  return [...m.entries()].filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => b[1] - a[1]);
};

/** The balance sheet at a date: credits shown as positive where they belong. */
export function position(L: Line[], date: string) {
  const u = upTo(L, date);
  const cash = sumOf(u, "cash");
  const ar = sumOf(u, "ar");
  const ppeCost = sumOf(u, "ppe");
  const accdep = -sumOf(u, "accdep");
  const wip = sumOf(u, "wip");
  const payables = -sumOf(u, "payables");
  const gst = -sumOf(u, "gst");
  const due = -sumOf(u, "due");
  const tax = -sumOf(u, "tax");
  const share = -sumOf(u, "share");
  const capital = -sumOf(u, "capital");
  const retained = -sumOf(u, [...PL, "approp", "retained"]);
  const assets = {
    ppe: ppeCost - accdep,
    wip,
    receivables: Math.max(0, ar),
    cash: Math.max(0, cash),
  };
  const liabilities = {
    payables,
    gst,
    due,
    tax,
    advances: Math.max(0, -ar),
    overdraft: Math.max(0, -cash),
  };
  const totalAssets = assets.ppe + assets.wip + assets.receivables + assets.cash;
  const totalLiabilities = Object.values(liabilities).reduce((a, v) => a + v, 0);
  const equity = { share, capital, retained, total: share + capital + retained };
  return { date, assets, liabilities, equity, totalAssets, totalLiabilities, ppeCost, accdep, difference: r2(totalAssets - totalLiabilities - equity.total) };
}

/** The income statement for a period. */
export function performance(L: Line[], from: string, to: string) {
  const w = within(L, from, to);
  const revenue = -sumOf(w, "revenue");
  const cogs = sumOf(w, "cogs");
  const admin = sumOf(w, ["admin", "salaries", "depreciation"]);
  const finance = sumOf(w, "finance");
  const tax = sumOf(w, "taxexp");
  const gross = revenue - cogs;
  const operating = gross - admin;
  const pbt = operating - finance;
  return { revenue, cogs, gross, admin, operating, finance, pbt, tax, pat: pbt - tax, depreciation: sumOf(w, "depreciation") };
}

/** The cash flow statement for a period, indirect method, reconciled to the cash lines. */
export function cashflow(L: Line[], from: string, to: string) {
  const before = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const a = position(L, before);
  const b = position(L, to);
  const p = performance(L, from, to);
  const w = within(L, from, to).filter((l) => l.acct === "cash");
  const flow = (f: Flow) => w.filter((l) => l.flow === f);
  const group = (f: Flow) => {
    const m = new Map<string, number>();
    for (const l of flow(f)) m.set(l.flowLabel ?? "Other", (m.get(l.flowLabel ?? "Other") ?? 0) + l.amount);
    return [...m.entries()];
  };
  const opening = sumOf(upTo(L, before), "cash");
  const closing = sumOf(upTo(L, to), "cash");
  // working capital: an increase in an asset takes cash, an increase in a liability gives it
  const dAr = -(sumOf(upTo(L, to), "ar") - sumOf(upTo(L, before), "ar"));
  const dWip = -(b.assets.wip - a.assets.wip);
  const dPay = b.liabilities.payables - a.liabilities.payables;
  const dGst = b.liabilities.gst - a.liabilities.gst;
  // tax is charged below profit before tax, so what reaches cash is only the tax actually paid
  const dTax = b.liabilities.tax - a.liabilities.tax - p.tax;
  const operatingDirect = flow("operating").reduce((s, l) => s + l.amount, 0);
  const investing = flow("investing").reduce((s, l) => s + l.amount, 0);
  const financing = flow("financing").reduce((s, l) => s + l.amount, 0);
  const adjusted = p.pbt + p.depreciation + p.finance;
  const indirect = adjusted + dAr + dWip + dPay + dGst + dTax;
  return {
    pbt: p.pbt,
    depreciation: p.depreciation,
    finance: p.finance,
    adjusted,
    dAr,
    dWip,
    dPay,
    dGst,
    dTax,
    // anything the lines above do not explain (should be nothing)
    other: r2(operatingDirect - indirect),
    operating: operatingDirect,
    investing,
    investingLines: group("investing"),
    financing,
    financingLines: group("financing"),
    net: closing - opening,
    opening,
    closing,
  };
}

/** Movements in equity over a period, by column. */
export function equityMoves(L: Line[], from: string, to: string) {
  const w = within(L, from, to);
  const perf = performance(L, from, to);
  const shareIn = -sumOf(w, "share");
  const capLines = w.filter((l) => l.acct === "capital");
  const introduced = capLines.filter((l) => l.memo === "Capital introduced").reduce((s, l) => s - l.amount, 0);
  const kept = capLines.filter((l) => l.memo.startsWith("Profit share kept")).reduce((s, l) => s - l.amount, 0);
  const drawn = capLines.filter((l) => l.memo === "Drawings").reduce((s, l) => s - l.amount, 0);
  const otherCap = -sumOf(capLines, "capital") - introduced - kept - drawn;
  const shares = -sumOf(w, "approp");
  const opening = -sumOf(w, "retained");
  return { profit: perf.pat, shares, shareIn, introduced, kept, drawn, otherCap, opening };
}

/** Everything the notes break down, for one year and the one before. */
export function notes(L: Line[], from: string, to: string) {
  const w = within(L, from, to);
  const u = upTo(L, to);
  return {
    revenue: bySub(w, "revenue", -1),
    cogs: bySub(w, "cogs"),
    admin: [...bySub(w, "admin"), ...(sumOf(w, "salaries") ? [["Salaries", sumOf(w, "salaries")] as [string, number]] : []), ...(sumOf(w, "depreciation") ? [["Depreciation", sumOf(w, "depreciation")] as [string, number]] : [])],
    finance: bySub(w, "finance"),
    receivables: bySub(u, "ar"),
    wip: bySub(u, "wip"),
    payables: bySub(u, "payables", -1),
    due: bySub(u, "due", -1),
    capital: bySub(u, "capital", -1),
    ppe: bySub(u, "ppe"),
  };
}
