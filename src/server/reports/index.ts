import { statements, ledgers } from "./statements";
import { lists } from "./lists";
import type { ReportDef } from "./common";

export type { Params, ReportDef, Filter } from "./common";
export { readParams, paramQuery } from "./common";

/** Every report, in the order the Reports page lists them. */
export const REPORTS: ReportDef[] = [...statements, ...lists, ...ledgers];
export const GROUPS = [
  "Financial statements", "Notes to the statements", "Projects", "Sales and receivables", "Expenses and payables",
  "Payroll", "Tax", "Partners and financing", "Banking and control",
];
export const reportByKey = (k: string) => REPORTS.find((r) => r.key === k);

/** Screens elsewhere that are reports in their own right (§11), listed on the Reports page too. */
export const ELSEWHERE: { group: string; title: string; href: string; description: string; payroll?: boolean }[] = [
  { group: "Projects", title: "Project detail P&L and Budget vs Actual", href: "/projects", description: "Open a project: Overview and Value & budget tabs" },
  { group: "Payroll", title: "Payslips", href: "/payroll", description: "Each run's payslips, printable", payroll: true },
  { group: "Tax", title: "GST return worksheet and schedules", href: "/taxes", description: "Each quarter's worksheet, output and input schedules (CSV)" },
  { group: "Partners and financing", title: "Partner statements", href: "/partners", description: "Per person: principal, financing return and profit share" },
  { group: "Partners and financing", title: "Distribution history", href: "/partners/distributions", description: "Every split and adjustment as posted" },
  { group: "Banking and control", title: "Reconciliation reports", href: "/banking", description: "Open an account; each finished reconciliation prints" },
  { group: "Banking and control", title: "Health check", href: "/accounting/health", description: "The 13 invariants, checked now" },
];

/** What the year-end pack for the auditor holds, in order. */
export const YEAR_END_PACK = [
  "profit-loss", "balance-sheet", "cash-flow", "equity", "trial-balance",
  "ar-aging", "vendor-balances", "loans", "related-parties", "payroll-costs", "gst-control", "bpt",
];
