import type { createClient } from "@/lib/supabase/server";
import { loadRecords, type Records } from "@/lib/accounting";
import { today } from "@/lib/format";
import { buildJournal, cashflow, equityMoves, notes, performance, position, type StatementSettings } from "@/lib/statements";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const prevDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** One year's statements, with the year before alongside, as the samples show them. */
export async function loadStatements(supabase: Supabase, yearParam?: string) {
  const [records, { data: company }] = await Promise.all([
    loadRecords(supabase),
    supabase.from("company").select("*").eq("id", true).maybeSingle(),
  ]);
  return statementsFrom(records, company, yearParam);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function statementsFrom(records: Records, company: Record<string, any> | null, yearParam?: string) {
  const now = today();
  const thisYear = Number(now.slice(0, 4));
  const year = /^\d{4}$/.test(yearParam ?? "") ? Math.min(Number(yearParam), thisYear) : thisYear;
  const settings: StatementSettings = {
    share_capital: Number(company?.share_capital ?? 0),
    share_capital_date: company?.share_capital_date ?? null,
    bpt_rate: Number(company?.bpt_rate ?? 15),
    bpt_threshold: Number(company?.bpt_threshold ?? 500000),
    asset_life_years: Number(company?.asset_life_years ?? 5),
    opening_cash: Number(company?.opening_cash ?? 0),
    gst_registered: Boolean(company?.gst_registered),
  };
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
  };
}

export type StatementsData = ReturnType<typeof statementsFrom>;
