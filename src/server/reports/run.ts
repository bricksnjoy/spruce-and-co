import type { Session } from "@/server/session";
import { today } from "@/lib/format";
import { readParams, reportByKey, type Params, type ReportDef } from "./index";
import type { Report } from "@/lib/report-model";

export type Ran = { def: ReportDef; params: Params; report: Report } | { error: string; status: number };

/** Run one report for the signed-in user with the filters in the query string. */
export async function runReport(s: Session, key: string, q: Record<string, string | undefined>): Promise<Ran> {
  const def = reportByKey(key);
  if (!def) return { error: "No such report.", status: 404 };
  if (s.role === "viewer") return { error: "Reports are for staff who work with the books.", status: 403 };
  if (def.payroll && !s.canPayroll) return { error: "This report shows payroll, which needs payroll permission.", status: 403 };
  const { data: st } = await s.supabase.from("settings").select("fiscal_year_start_month").eq("id", true).maybeSingle();
  const params = readParams(q, today(), st?.fiscal_year_start_month ?? 1);
  try {
    return { def, params, report: await def.build(s, params) };
  } catch (e) {
    return { error: (e as Error).message || "The report could not be run.", status: 500 };
  }
}
