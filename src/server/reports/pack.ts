import type { Session } from "@/server/session";
import type { Report } from "@/lib/report-model";
import { YEAR_END_PACK, reportByKey } from "./index";
import { runReport } from "./run";

/** The year-end pack: each statement and schedule for the auditor, for the same period. */
export async function yearEndPack(s: Session, q: Record<string, string | undefined>): Promise<{ reports: Report[]; skipped: string[] }> {
  const reports: Report[] = [];
  const skipped: string[] = [];
  for (const key of YEAR_END_PACK) {
    const r = await runReport(s, key, { ...q, compare: ["profit-loss", "balance-sheet", "cash-flow"].includes(key) ? "prior_year" : undefined, by: undefined });
    if ("error" in r) skipped.push(`${reportByKey(key)?.title ?? key}: ${r.error}`);
    else reports.push(r.report);
  }
  return { reports, skipped };
}
