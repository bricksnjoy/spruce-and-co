import type { Session } from "./session";
import { dbToLaari } from "@/lib/money";
import type { StatementRow } from "@/lib/partners";

export type AccountProject = { id: string; code: string; name: string; completed_at: string | null };
/** One project on a partner's account, in laari. */
export type PartnerLine = { lent: bigint; repaid: bigint; ret: bigint; share: bigint; paid: bigint; owed: bigint };
/** One completed project on the company's account, in laari. */
export type CompanyLine = { profit: bigint; shared: bigint };
export type Account = {
  id: string; name: string; kind: "company" | "director" | "lender";
  /** Owed to them on projects, plus (a director) what is in their director's account; the company's own money for the company. */
  balance: bigint;
  /** A director's account balance (money kept in the company). */
  inAccount: bigint;
  partnerLines: [string, PartnerLine][];
  companyLines: [string, CompanyLine][];
};

/**
 * The company's and each partner's account, project by project: what was lent
 * and repaid, the return and profit share earned, paid out and still owed; and
 * for the company, each completed project's profit and what it keeps.
 */
export async function loadAccounts(s: Session) {
  const [{ data: statement }, { data: contacts }, { data: projects }, { data: dists }, { data: accounts }, { data: capital }] = await Promise.all([
    s.supabase.from("partner_statement_v").select("contact_id, project_id, component, accrued, paid, outstanding"),
    s.supabase.from("contacts").select("id, name, kinds").or("kinds.cs.{partner},kinds.cs.{lender}").order("name"),
    s.supabase.from("projects").select("id, code, name, completed_at").order("code"),
    s.supabase.from("distributions").select("project_id, created_at, profit_amount, distribution_lines(amount)").order("created_at"),
    s.supabase.from("director_accounts_v").select("contact_id, balance").eq("book", s.book),
    s.supabase.rpc("company_capital_available"),
  ]);
  const rows = (statement ?? []) as StatementRow[];
  const proj = new Map(((projects ?? []) as AccountProject[]).map((p) => [p.id, p]));
  const byCode = (a: string, b: string) => (proj.get(a)?.code ?? "").localeCompare(proj.get(b)?.code ?? "");
  const inAccount = new Map(((accounts ?? []) as { contact_id: string; balance: string | number }[]).map((a) => [a.contact_id, dbToLaari(a.balance)]));
  const companyMoney = dbToLaari(((capital ?? []) as { contact_id: string | null; available: string | number }[]).find((c) => c.contact_id === null)?.available);

  // the company keeps what each completed project's profit leaves after the returns and shares (net of every adjustment)
  const byProject = new Map<string, CompanyLine>();
  for (const d of (dists ?? []) as { project_id: string; profit_amount: string | number; distribution_lines: { amount: string | number }[] }[]) {
    const x = byProject.get(d.project_id) ?? { profit: 0n, shared: 0n };
    x.profit = dbToLaari(d.profit_amount); // the latest is the current profit
    x.shared += (d.distribution_lines ?? []).reduce((t, l) => t + dbToLaari(l.amount), 0n);
    byProject.set(d.project_id, x);
  }
  const company: Account = {
    id: "company", name: "Company", kind: "company", balance: companyMoney, inAccount: 0n, partnerLines: [],
    companyLines: [...byProject.entries()].filter(([pid]) => proj.has(pid)).sort(([a], [b]) => byCode(a, b)),
  };

  const people: Account[] = ((contacts ?? []) as { id: string; name: string; kinds: string[] }[])
    .filter((c) => c.kinds.includes("partner") || rows.some((r) => r.contact_id === c.id))
    .map((c) => {
      const lines = new Map<string, PartnerLine>();
      for (const r of rows.filter((x) => x.contact_id === c.id)) {
        const l = lines.get(r.project_id) ?? { lent: 0n, repaid: 0n, ret: 0n, share: 0n, paid: 0n, owed: 0n };
        const accrued = dbToLaari(r.accrued), paid = dbToLaari(r.paid);
        if (r.component === "principal") { l.lent += accrued; l.repaid += paid; }
        else { if (r.component === "financing_return") l.ret += accrued; else l.share += accrued; l.paid += paid; }
        l.owed += dbToLaari(r.outstanding);
        lines.set(r.project_id, l);
      }
      const partnerLines = [...lines.entries()].sort(([a], [b]) => byCode(a, b));
      const kept = inAccount.get(c.id) ?? 0n;
      return {
        id: c.id, name: c.name, kind: c.kinds.includes("partner") ? "director" as const : "lender" as const,
        balance: partnerLines.reduce((t, [, l]) => t + l.owed, 0n) + kept, inAccount: kept, partnerLines, companyLines: [],
      };
    });

  return { company, people, proj };
}

export const ACCOUNT_LABEL: Record<Account["kind"], string> = { company: "Company account", director: "Director's account", lender: "Lender account" };

/** Two initials for the round badge: "Mushahid Rasheed" → MR, "Muaz" → MU. */
export function initialsOf(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] ?? "?").slice(0, 2)).toUpperCase();
}
