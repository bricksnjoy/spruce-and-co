import { dbToLaari } from "./money";

export type StatementRow = { contact_id: string; project_id: string; component: string; accrued: number | string; paid: number | string; outstanding: number | string };
export type ProjectPayout = {
  id: string; code: string; name: string; completed_at: string | null; stage: string; scheme_name: string | null;
  financed: number | string; principal_outstanding: number | string; returns_outstanding: number | string;
  split_profit: number | string | null; blocked: boolean; blocked_reason: string | null; client_owes: number | string;
};
export const COMPONENT_LABEL: Record<string, string> = { principal: "Principal", financing_return: "Financing return", profit_share: "Profit share" };
export const COMPONENTS = ["principal", "financing_return", "profit_share"] as const;

/** Each person's accrued, paid and outstanding per component, in laari, summed over projects. */
export function byPerson(rows: StatementRow[]) {
  const out = new Map<string, Record<string, { accrued: bigint; paid: bigint; outstanding: bigint }>>();
  for (const r of rows) {
    const p = out.get(r.contact_id) ?? Object.fromEntries(COMPONENTS.map((c) => [c, { accrued: 0n, paid: 0n, outstanding: 0n }]));
    const c = p[r.component] ?? (p[r.component] = { accrued: 0n, paid: 0n, outstanding: 0n });
    c.accrued += dbToLaari(r.accrued); c.paid += dbToLaari(r.paid); c.outstanding += dbToLaari(r.outstanding);
    out.set(r.contact_id, p);
  }
  return out;
}
