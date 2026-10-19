import type { Session } from "@/server/session";
import { fiscalYearStart, readRange, type Compare, type Preset, type Range } from "@/lib/report-period";
import { rollup, type Acct, type Report, type TbRow } from "@/lib/report-model";
import { docHref } from "@/lib/doc-href";

export type Filter = "range" | "asAt" | "compare" | "project" | "contact" | "account" | "employee" | "by";
export type Params = {
  preset: Preset; range: Range; compare: Compare; prior: Range | null; today: string; fyStart: number;
  project: string | null; contact: string | null; account: string | null; employee: string | null; by: string | null; txn: string | null;
};
export type ReportDef = {
  key: string; title: string; group: string; description: string; filters: Filter[];
  /** choices for the "by" filter */
  by?: [string, string][];
  payroll?: boolean;
  build: (s: Session, p: Params) => Promise<Report>;
};

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export function readParams(q: Record<string, string | undefined>, today: string, fyStart: number): Params {
  const r = readRange(q, today, fyStart);
  return {
    ...r, today, fyStart,
    project: isId(q.project) ? q.project : null, contact: isId(q.contact) ? q.contact : null,
    account: isId(q.account) ? q.account : null, employee: isId(q.employee) ? q.employee : null,
    by: q.by && /^[a-z_]{1,20}$/.test(q.by) ? q.by : null, txn: isId(q.txn) ? q.txn : null,
  };
}

/** The query string that reproduces these params (for links, exports and saved reports). */
export function paramQuery(p: Params, extra: Record<string, string | null | undefined> = {}) {
  const u = new URLSearchParams();
  if (p.preset === "custom") { u.set("preset", "custom"); u.set("from", p.range.from); u.set("to", p.range.to); } else u.set("preset", p.preset);
  if (p.compare !== "none") u.set("compare", p.compare);
  for (const k of ["project", "contact", "account", "employee", "by", "txn"] as const) if (p[k]) u.set(k, p[k]!);
  for (const [k, v] of Object.entries(extra)) { if (v) u.set(k, v); else u.delete(k); }
  return u.toString();
}

/** A link to the general ledger for one account over a range. */
export const glHref = (account: string, r: Range, extra: Record<string, string | null> = {}) => {
  const u = new URLSearchParams({ preset: "custom", from: r.from, to: r.to, account });
  for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v);
  return `/reports/general-ledger?${u}`;
};
/** Where a transaction is shown: its document page, else the journal report for it. */
export const txnHref = (type: string | null | undefined, id: string) => docHref(type, id) ?? `/reports/journal?txn=${id}`;

export async function parentsOf(s: Session) {
  const { data } = await s.supabase.from("accounts").select("id, code, name, parent_id");
  const all = data ?? [];
  const parentIds = new Set(all.filter((a) => a.parent_id).map((a) => a.parent_id as string));
  return new Map(all.filter((a) => parentIds.has(a.id)).map((a) => [a.id, { code: a.code as string, name: a.name as string }]));
}

/** The trial balance for a range, folded to parent accounts. */
export async function tb(s: Session, r: Range, opts: { project?: string | null; contact?: string | null; raw?: boolean } = {}): Promise<Acct[]> {
  const [{ data, error }, parents] = await Promise.all([
    s.supabase.rpc("report_tb", { p_from: r.from, p_to: r.to, p_project: opts.project ?? null, p_contact: opts.contact ?? null }),
    opts.raw ? Promise.resolve(new Map()) : parentsOf(s),
  ]);
  if (error) throw new Error(error.message);
  return rollup((data ?? []) as TbRow[], parents);
}

/** The range from the start of `to`'s financial year to `to` (for a balance sheet as at `to`). */
export const yearTo = (to: string, fyStart: number): Range => ({ from: fiscalYearStart(to, fyStart), to });

export async function names(s: Session, table: "contacts" | "projects" | "employees", ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const cols = table === "projects" ? "id, code, name" : "id, name";
  const { data } = await s.supabase.from(table).select(cols).in("id", ids);
  return new Map(((data ?? []) as unknown as { id: string; name: string; code?: string }[]).map((r) => [r.id, r.code ? `${r.code} ${r.name}` : r.name]));
}

/** Days past due on `today` (negative: not yet due). */
export const daysPast = (due: string | null, today: string) => (due ? Math.round((Date.parse(today) - Date.parse(due)) / 86400000) : 0);
export const BUCKETS: [string, string, (d: number) => boolean][] = [
  ["current", "Current", (d) => d <= 0], ["d30", "1–30", (d) => d >= 1 && d <= 30], ["d60", "31–60", (d) => d >= 31 && d <= 60],
  ["d90", "61–90", (d) => d >= 61 && d <= 90], ["d91", "Over 90", (d) => d > 90],
];
