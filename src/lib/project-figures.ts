/** A row of project_list_v: one project with every figure from project_figures(). */
export type ProjectFigures = {
  id: string; book: string; code: string; name: string; customer_id: string | null; customer_name: string | null;
  status: string; stage: "active" | "completed" | "settled" | "closed"; completed_at: string | null; archived_at: string | null;
  recognition_method: string | null; start_date: string | null; end_date: string | null;
  original: number; variations: number; revised: number; billed: number; billed_pct: number; remaining_to_bill: number;
  collected: number; client_balance: number; retention_held: number; cost_to_date: number; budget: number; revised_budget: number;
  forecast_to_complete: number; forecast_final_cost: number; forecast_profit: number; margin_pct: number; pct_complete: number;
  earned: number; over_under_billing: number; actual_profit: number; bad_debts: number;
  costs: { category: string; actual: number; budget: number; revised: number; forecast_to_complete: number }[];
};

export const STAGE_LABEL: Record<string, string> = {
  active: "Active", completed: "Completed · client owes", settled: "Settled · payouts due", closed: "Closed",
};

/** Each stage's colour: a badge, and a bar down the side of its row. Active blue, completed amber, settled green, closed grey. */
export const STAGE_TONE: Record<string, { badge: string; bar: string }> = {
  active: { badge: "bg-blue-50 text-blue-700 ring-blue-200", bar: "border-l-blue-600" },
  completed: { badge: "bg-amber-50 text-amber-800 ring-amber-200", bar: "border-l-amber-500" },
  settled: { badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", bar: "border-l-green-500" },
  closed: { badge: "bg-slate-100 text-slate-600 ring-slate-200", bar: "border-l-slate-400" },
};
