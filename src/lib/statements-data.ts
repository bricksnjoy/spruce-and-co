import type { createClient } from "@/lib/supabase/server";
import { loadRecords, type Records } from "@/lib/accounting";
import { signingKit } from "@/lib/branding";
import { today } from "@/lib/format";
import { buildJournal, cashflow, equityMoves, notes, performance, position, type StatementSettings } from "@/lib/statements";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const prevDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** The directors' report, the board's approval and whether the year is closed. */
export interface YearInfo {
  principal_activity: string | null;
  directors: string[];
  report_note: string | null;
  approved_on: string | null;
  signer: { name: string; title: string | null; signatureUrl: string | null } | null;
  stampUrl: string | null;
  closed_at: string | null;
}

export function settingsFrom(company: Row | null): StatementSettings {
  return {
    share_capital: Number(company?.share_capital ?? 0),
    share_capital_date: company?.share_capital_date ?? null,
    bpt_rate: Number(company?.bpt_rate ?? 15),
    bpt_threshold: Number(company?.bpt_threshold ?? 500000),
    asset_life_years: Number(company?.asset_life_years ?? 5),
    opening_cash: Number(company?.opening_cash ?? 0),
    gst_registered: Boolean(company?.gst_registered),
  };
}

/** The books: every record, the company's settings and the journal built from them. */
export async function loadBooks(supabase: Supabase) {
  const [records, { data: company }] = await Promise.all([
    loadRecords(supabase),
    supabase.from("company").select("*").eq("id", true).maybeSingle(),
  ]);
  const settings = settingsFrom(company);
  const thisYear = Number(today().slice(0, 4));
  const L = buildJournal(records, settings, `${thisYear}-12-31`);
  const first = L[0]?.date.slice(0, 4);
  const years = first ? Array.from({ length: thisYear - Number(first) + 1 }, (_, i) => thisYear - i) : [thisYear];
  return { records, company, settings, L, years, thisYear };
}

/** One year's statements, with the year before alongside, as the samples show them. */
export async function loadStatements(supabase: Supabase, yearParam?: string) {
  const [records, { data: company }, { data: fys }, kit] = await Promise.all([
    loadRecords(supabase),
    supabase.from("company").select("*").eq("id", true).maybeSingle(),
    supabase.from("financial_years").select("*"),
    signingKit(supabase),
  ]);
  const data = statementsFrom(records, company, yearParam);
  const fy = (fys ?? []).find((f) => f.year === data.current.year);
  const s = fy?.signatory_id ? kit.signatories.find((x) => x.id === fy.signatory_id) : null;
  const info: YearInfo = {
    principal_activity: fy?.principal_activity ?? null,
    directors: String(fy?.directors ?? "").split("\n").map((x) => x.trim()).filter(Boolean),
    report_note: fy?.report_note ?? null,
    approved_on: fy?.approved_on ?? null,
    signer: s ? { name: s.name, title: s.title, signatureUrl: s.signatureUrl } : null,
    stampUrl: fy?.show_stamp !== false ? kit.stampUrl : null,
    closed_at: fy?.closed_at ?? null,
  };
  return { ...data, info };
}

export function statementsFrom(records: Records, company: Row | null, yearParam?: string) {
  const now = today();
  const thisYear = Number(now.slice(0, 4));
  const year = /^\d{4}$/.test(yearParam ?? "") ? Math.min(Number(yearParam), thisYear) : thisYear;
  const settings = settingsFrom(company);
  const filed = new Set((records.taxReturns ?? []).map((t) => Number(t.year)));
  const L = buildJournal(records, settings, `${year}-12-31`);
  const first = L[0]?.date.slice(0, 4);
  const years = first ? Array.from({ length: thisYear - Number(first) + 1 }, (_, i) => thisYear - i) : [thisYear];

  const projects = new Map(records.projects.map((p) => [p.id, `${p.code} ${p.name}`]));
  const label = (rows: [string, number][]) => rows.map(([k, v]) => [projects.get(k) ?? k, v] as [string, number]);

  const period = (y: number) => {
    const from = `${y}-01-01`;
    const to = `${y}-12-31`;
    const nt = notes(L, from, to);
    return {
      year: y,
      from,
      to,
      // a year still running is shown to date
      toDate: y === thisYear && now < to,
      taxFiled: filed.has(y),
      position: position(L, to),
      opening: position(L, prevDay(from)),
      performance: performance(L, from, to),
      cashflow: cashflow(L, from, to),
      equity: equityMoves(L, from, to),
      notes: { ...nt, revenue: label(nt.revenue), wip: label(nt.wip) },
    };
  };

  return {
    company: {
      name: (company?.legal_name as string | undefined) || "Spruce & Co Private Limited",
      registration: (company?.registration_no as string | null) ?? null,
      tin: (company?.tin as string | null) ?? null,
      address: (company?.address as string | null) ?? null,
    },
    settings,
    years,
    current: period(year),
    prior: period(year - 1),
    journal: L,
    projectName: (id: string) => projects.get(id) ?? id,
  };
}

export type StatementsData = ReturnType<typeof statementsFrom> & { info?: YearInfo };
