import { balanceSheet, profitLoss, type Acct, type Col, type Row } from "@/lib/report-model";
import { dbToLaari } from "@/lib/money";
import { date, titleize } from "@/lib/format";
import { rangeLabel, type Range } from "@/lib/report-period";
import { glHref, names, tb, txnHref, yearTo, type ReportDef } from "./common";

const G = "Financial statements";
const L = (v: number | string | null | undefined) => dbToLaari(v ?? 0);

/** Months (or quarters) covering a range, capped at 24 columns. */
function slices(r: Range, step: 1 | 3): Range[] {
  const out: Range[] = [];
  let [y, m] = r.from.split("-").map(Number);
  if (step === 3) m = Math.floor((m - 1) / 3) * 3 + 1;
  while (out.length < 24) {
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(y, m - 1 + step, 0)).toISOString().slice(0, 10);
    out.push({ from: from < r.from ? r.from : from, to: end > r.to ? r.to : end });
    if (end >= r.to) break;
    m += step; if (m > 12) { m -= 12; y += 1; }
  }
  return out;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sliceLabel = (r: Range, step: 1 | 3) => {
  const [y, m] = r.from.split("-").map(Number);
  return step === 1 ? `${MON[m - 1]} ${y}` : `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
};

export const statements: ReportDef[] = [
  {
    key: "profit-loss", title: "Statement of Profit or Loss", group: G,
    description: "Revenue, cost of sales, gross profit, expenses and profit; by month, quarter or project; % of revenue; comparatives",
    filters: ["range", "compare", "project", "by"], by: [["total", "Total"], ["month", "By month"], ["quarter", "By quarter"], ["project", "By project"]],
    async build(s, p) {
      const link = (r: Range) => (id: string) => glHref(id, r, { project: p.project });
      if (p.by === "month" || p.by === "quarter") {
        const step = p.by === "month" ? 1 : 3;
        const parts = slices(p.range, step);
        const series = await Promise.all(parts.map(async (r, i) => ({ key: `c${i}`, label: sliceLabel(r, step), accts: await tb(s, r, { project: p.project }) })));
        const tot = { key: "total", label: "Total", accts: await tb(s, p.range, { project: p.project }) };
        const all = [...series, tot];
        return {
          title: "Statement of Profit or Loss", subtitle: rangeLabel(p.range),
          columns: [{ key: "label", label: "" }, ...all.map((x) => ({ key: x.key, label: x.label, kind: "money" as const }))],
          rows: profitLoss(all, (id, k) => link(k === "total" ? p.range : parts[Number(k.slice(1))])(id)),
        };
      }
      if (p.by === "project") {
        const [{ data }, accts] = await Promise.all([
          s.supabase.rpc("report_by", { p_from: p.range.from, p_to: p.range.to, p_dim: "project" }),
          tb(s, p.range),
        ]);
        const rows = (data ?? []) as { dim_id: string | null; account_id: string; amount: number | string }[];
        const ids = [...new Set(rows.map((r) => r.dim_id).filter(Boolean))] as string[];
        const nm = await names(s, "projects", ids);
        const meta = new Map(accts.map((a) => [a.id, a]));
        const { data: accounts } = await s.supabase.from("accounts").select("id, parent_id");
        const parent = new Map((accounts ?? []).map((a) => [a.id, (a.parent_id as string | null) ?? a.id]));
        const seriesFor = (dim: string | null, key: string, label: string) => {
          const by = new Map<string, Acct>();
          for (const r of rows.filter((x) => x.dim_id === dim)) {
            const id = meta.has(r.account_id) ? r.account_id : parent.get(r.account_id) ?? r.account_id;
            const m = meta.get(id);
            if (!m) continue;
            const a = by.get(id) ?? { ...m, opening: 0n, debit: 0n, credit: 0n, closing: 0n };
            const v = L(r.amount);
            if (v > 0n) a.credit += v; else a.debit -= v;
            by.set(id, a);
          }
          return { key, label, accts: [...by.values()] };
        };
        const series = [...ids.sort((a, b) => (nm.get(a) ?? "").localeCompare(nm.get(b) ?? "")).map((id, i) => seriesFor(id, `p${i}`, nm.get(id) ?? "—")),
          seriesFor(null, "none", "No project"), { key: "total", label: "Total", accts }];
        const keyToProject = new Map(ids.map((id, i) => [`p${i}`, id]));
        return {
          title: "Statement of Profit or Loss by project", subtitle: rangeLabel(p.range),
          columns: [{ key: "label", label: "" }, ...series.map((x) => ({ key: x.key, label: x.label, kind: "money" as const }))],
          rows: profitLoss(series, (id, k) => glHref(id, p.range, { project: keyToProject.get(k) ?? null })),
        };
      }
      const cur = { key: "cur", label: rangeLabel(p.range), accts: await tb(s, p.range, { project: p.project }) };
      const series = [cur];
      if (p.prior) series.push({ key: "prior", label: rangeLabel(p.prior), accts: await tb(s, p.prior, { project: p.project }) });
      const cols: Col[] = [{ key: "label", label: "" }, ...series.map((x): Col => ({ key: x.key, label: x.label, kind: "money" }))];
      if (series.length === 1) cols.push({ key: "pct", label: "% of revenue", kind: "pct" });
      return {
        title: "Statement of Profit or Loss", subtitle: `${rangeLabel(p.range)}${p.project ? ` · ${(await names(s, "projects", [p.project])).get(p.project) ?? ""}` : ""}`,
        columns: cols, rows: profitLoss(series, (id, k) => link(k === "prior" ? p.prior! : p.range)(id)),
      };
    },
  },
  {
    key: "balance-sheet", title: "Statement of Financial Position", group: G,
    description: "Assets, liabilities and equity as at a date, with comparatives", filters: ["asAt", "compare"],
    async build(s, p) {
      const cur = { key: "cur", label: `At ${date(p.range.to)}`, accts: await tb(s, yearTo(p.range.to, p.fyStart)) };
      const series = [cur];
      if (p.prior) series.push({ key: "prior", label: `At ${date(p.prior.to)}`, accts: await tb(s, yearTo(p.prior.to, p.fyStart)) });
      const to = (k: string) => (k === "prior" ? p.prior!.to : p.range.to);
      return {
        title: "Statement of Financial Position", subtitle: `As at ${date(p.range.to)}`,
        columns: [{ key: "label", label: "" }, ...series.map((x) => ({ key: x.key, label: x.label, kind: "money" as const }))],
        rows: balanceSheet(series, (id, k) => glHref(id, { from: "2000-01-01", to: to(k) })),
        notes: ["Liabilities are shown together; loan terms are not recorded, so they are not split into current and non-current."],
      };
    },
  },
  {
    key: "cash-flow", title: "Statement of Cash Flows", group: G,
    description: "Indirect method, with a direct summary of cash in and out", filters: ["range", "compare"],
    async build(s, p) {
      type CF = { section: string; sort: number; label: string; amount: number | string };
      const load = async (r: Range) => {
        const [{ data: cf, error }, { data: dir }] = await Promise.all([
          s.supabase.rpc("cash_flow", { p_from: r.from, p_to: r.to }),
          s.supabase.rpc("cash_summary", { p_from: r.from, p_to: r.to }),
        ]);
        if (error) throw new Error(error.message);
        return { cf: (cf ?? []) as CF[], dir: (dir ?? []) as { kind: string; cash_in: number | string; cash_out: number | string }[] };
      };
      const cur = await load(p.range);
      const prior = p.prior ? await load(p.prior) : null;
      const keys = prior ? ["cur", "prior"] : ["cur"];
      const rows: Row[] = [];
      const get = (d: typeof cur | null, pick: (x: CF) => boolean) => (d ? d.cf.filter(pick).reduce((t, x) => t + L(x.amount), 0n) : 0n);
      const line = (label: string, pick: (x: CF) => boolean, style?: Row["style"]) => {
        const cells: Row["cells"] = { label, cur: get(cur, pick) };
        if (prior) cells.prior = get(prior, pick);
        rows.push({ cells, style });
      };
      const labels = (section: string) => [...new Map([...cur.cf, ...(prior?.cf ?? [])].filter((x) => x.section === section)
        .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label)).map((x) => [x.label, x])).keys()];
      const SECTIONS: [string, string, string][] = [
        ["operating", "Cash flows from operating activities", "Net cash from operating activities"],
        ["investing", "Cash flows from investing activities", "Net cash used in investing activities"],
        ["financing", "Cash flows from financing activities", "Net cash from financing activities"],
      ];
      for (const [sec, title, total] of SECTIONS) {
        rows.push({ cells: { label: title }, style: "section" });
        for (const l of labels(sec)) line(l, (x) => x.section === sec && x.label === l, "indent");
        line(total, (x) => x.section === sec, "subtotal");
      }
      if (labels("opening_balances").length) line("Opening balances entered", (x) => x.section === "opening_balances");
      line("Net change in cash", (x) => ["operating", "investing", "financing", "opening_balances"].includes(x.section), "total");
      line("Cash at the start of the period", (x) => x.section === "cash_start");
      line("Cash at the end of the period", (x) => x.section === "cash_end", "total");
      rows.push({ cells: { label: "Direct summary: cash in and out" }, style: "section" });
      const kinds = [...new Set([...cur.dir, ...(prior?.dir ?? [])].map((d) => d.kind))].sort();
      for (const k of kinds) {
        const net = (d: typeof cur | null) => { const x = d?.dir.find((y) => y.kind === k); return x ? L(x.cash_in) - L(x.cash_out) : 0n; };
        const cells: Row["cells"] = { label: titleize(k), cur: net(cur) };
        if (prior) cells.prior = net(prior);
        rows.push({ cells, style: "indent" });
      }
      return {
        title: "Statement of Cash Flows", subtitle: rangeLabel(p.range),
        columns: [{ key: "label", label: "" }, ...keys.map((k) => ({ key: k, label: rangeLabel(k === "prior" ? p.prior! : p.range), kind: "money" as const }))],
        rows,
        notes: ["Payments of financing returns and profit shares to partners and lenders are shown as financing activities."],
      };
    },
  },
  {
    key: "equity", title: "Statement of Changes in Equity", group: G,
    description: "Share capital, retained earnings, profit for the period and dividends", filters: ["range"],
    async build(s, p) {
      const { data, error } = await s.supabase.rpc("equity_changes", { p_from: p.range.from, p_to: p.range.to });
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as { sort: number; label: string; share_capital: number; retained_earnings: number; other_equity: number; total: number }[])
        .sort((a, b) => a.sort - b.sort)
        .map((r) => ({ cells: { label: r.label, sc: L(r.share_capital), re: L(r.retained_earnings), ot: L(r.other_equity), total: L(r.total) },
          style: (r.sort === 0 || r.sort === 9 ? "total" : "indent") as Row["style"] }));
      return {
        title: "Statement of Changes in Equity", subtitle: rangeLabel(p.range),
        columns: [{ key: "label", label: "" }, { key: "sc", label: "Share capital", kind: "money" }, { key: "re", label: "Retained earnings", kind: "money" },
          { key: "ot", label: "Other equity", kind: "money" }, { key: "total", label: "Total", kind: "money" }],
        rows,
      };
    },
  },
  {
    key: "trial-balance", title: "Trial Balance", group: G,
    description: "Every account: opening, debits, credits and closing", filters: ["range", "project"],
    async build(s, p) {
      const accts = await tb(s, p.range, { project: p.project, raw: true });
      const rows: Row[] = accts.filter((a) => a.opening || a.debit || a.credit).map((a) => ({
        cells: { label: `${a.code} ${a.name}`, opening: a.opening, debit: a.debit, credit: a.credit, closing: a.closing },
        href: glHref(a.id, p.range, { project: p.project }),
      }));
      const sum = (k: "opening" | "debit" | "credit" | "closing") => accts.reduce((t, a) => t + a[k], 0n);
      rows.push({ cells: { label: "Total", opening: sum("opening"), debit: sum("debit"), credit: sum("credit"), closing: sum("closing") }, style: "total" });
      return {
        title: "Trial Balance", subtitle: rangeLabel(p.range),
        columns: [{ key: "label", label: "Account" }, { key: "opening", label: "Opening", kind: "money" }, { key: "debit", label: "Debits", kind: "money" },
          { key: "credit", label: "Credits", kind: "money" }, { key: "closing", label: "Closing", kind: "money" }],
        rows, notes: ["Debit balances are positive, credit balances negative. Opening and closing totals are zero when the books balance."],
      };
    },
  },
];

const LINE_LIMIT = 3000;
type Jl = { id: number; date: string; home_debit: number | string; home_credit: number | string; memo: string | null; transaction_id: string; account_id: string;
  transactions: { number: string | null; type: string; memo: string | null } | null; contacts: { name: string } | null; projects: { code: string } | null };

export const ledgers: ReportDef[] = [
  {
    key: "general-ledger", title: "General Ledger", group: "Banking and control",
    description: "Every line posted, by account, with opening and running balances", filters: ["range", "account", "project", "contact"],
    async build(s, p) {
      const accts = await tb(s, p.range, { project: p.project, contact: p.contact, raw: true });
      let q = s.supabase.from("journal_lines")
        .select("id, date, home_debit, home_credit, memo, transaction_id, account_id, transactions(number, type, memo), contacts(name), projects(code)", { count: "exact" })
        .gte("date", p.range.from).lte("date", p.range.to).order("date").order("id").limit(LINE_LIMIT);
      if (p.account) q = q.eq("account_id", p.account);
      if (p.project) q = q.eq("project_id", p.project);
      if (p.contact) q = q.eq("contact_id", p.contact);
      const { data, count } = await q;
      const lines = (data ?? []) as unknown as Jl[];
      const rows: Row[] = [];
      for (const a of accts.filter((x) => (!p.account || x.id === p.account) && (x.opening || x.debit || x.credit))) {
        rows.push({ cells: { label: `${a.code} ${a.name}` }, style: "section" });
        let run = a.opening;
        rows.push({ cells: { label: "Opening balance", balance: run }, style: "muted" });
        for (const l of lines.filter((x) => x.account_id === a.id)) {
          run += L(l.home_debit) - L(l.home_credit);
          rows.push({
            cells: { date: l.date, label: [titleize(l.transactions?.type), l.transactions?.number].filter(Boolean).join(" "),
              who: l.contacts?.name ?? l.projects?.code ?? "", memo: l.memo ?? l.transactions?.memo ?? "",
              debit: L(l.home_debit) || null, credit: L(l.home_credit) || null, balance: run },
            href: txnHref(l.transactions?.type, l.transaction_id),
          });
        }
        rows.push({ cells: { label: "Closing balance", debit: a.debit, credit: a.credit, balance: a.closing }, style: "subtotal" });
      }
      return {
        title: "General Ledger", subtitle: rangeLabel(p.range),
        columns: [{ key: "date", label: "Date", kind: "date" }, { key: "label", label: "Entry" }, { key: "who", label: "Name / project" }, { key: "memo", label: "Memo" },
          { key: "debit", label: "Debit", kind: "money" }, { key: "credit", label: "Credit", kind: "money" }, { key: "balance", label: "Balance", kind: "money" }],
        rows,
        notes: (count ?? 0) > LINE_LIMIT ? [`Only the first ${LINE_LIMIT} of ${count} lines are listed; choose an account or a shorter range. Opening and closing balances are complete.`] : [],
      };
    },
  },
  {
    key: "journal", title: "Journal", group: "Banking and control",
    description: "Each transaction with its debit and credit lines", filters: ["range"],
    async build(s, p) {
      let q = s.supabase.from("transactions")
        .select("id, date, number, type, memo, voided_at, journal_lines(home_debit, home_credit, memo, accounts(code, name))")
        .eq("is_draft", false).order("date").order("created_at").limit(500);
      q = p.txn ? q.eq("id", p.txn) : q.gte("date", p.range.from).lte("date", p.range.to);
      const { data } = await q;
      const rows: Row[] = [];
      type T = { id: string; date: string; number: string | null; type: string; memo: string | null; voided_at: string | null;
        journal_lines: { home_debit: number; home_credit: number; memo: string | null; accounts: { code: string; name: string } | null }[] };
      for (const t of (data ?? []) as unknown as T[]) {
        if (!t.journal_lines.length) continue;
        rows.push({ cells: { date: t.date, label: `${titleize(t.type)} ${t.number ?? ""}${t.voided_at ? " (void)" : ""}`, memo: t.memo ?? "" },
          href: txnHref(t.type, t.id), style: "section" });
        for (const l of t.journal_lines) {
          rows.push({ cells: { label: `${l.accounts?.code ?? ""} ${l.accounts?.name ?? ""}`, memo: l.memo ?? "", debit: L(l.home_debit) || null, credit: L(l.home_credit) || null }, style: "indent" });
        }
      }
      return {
        title: "Journal", subtitle: p.txn ? "One transaction" : rangeLabel(p.range),
        columns: [{ key: "date", label: "Date", kind: "date" }, { key: "label", label: "Entry / account" }, { key: "memo", label: "Memo" },
          { key: "debit", label: "Debit", kind: "money" }, { key: "credit", label: "Credit", kind: "money" }],
        rows, notes: (data ?? []).length >= 500 ? ["Only the first 500 transactions are listed; choose a shorter range."] : [],
      };
    },
  },
];

