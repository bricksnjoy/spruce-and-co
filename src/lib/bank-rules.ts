import { dbToLaari } from "./money";

export type BankRule = { id: string; name: string; priority: number; contains: string | null; direction: "in" | "out" | "any";
  min_amount: number | string | null; max_amount: number | string | null; account_id: string; contact_id: string | null; project_id: string | null;
  active: boolean; created_at: string };

/** The rule that fits a statement line best — the same test as the database's bank_rule_for(). */
export function ruleFor(rules: BankRule[], line: { description: string; amount: number | string }): BankRule | undefined {
  const amt = dbToLaari(line.amount);
  const abs = amt < 0n ? -amt : amt;
  return rules
    .filter((r) => r.active)
    .filter((r) => !r.contains || line.description.toLowerCase().includes(r.contains.toLowerCase()))
    .filter((r) => r.direction === "any" || (r.direction === "in" && amt > 0n) || (r.direction === "out" && amt < 0n))
    .filter((r) => (r.min_amount == null || abs >= dbToLaari(r.min_amount)) && (r.max_amount == null || abs <= dbToLaari(r.max_amount)))
    .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))[0];
}
