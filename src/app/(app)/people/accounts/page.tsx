import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Stat, Table, Th, Td } from "@/components/ui";
import { getSession } from "@/server/session";
import { money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";
import type { StatementRow } from "@/lib/partners";

export const dynamic = "force-dynamic";
const m = (v: bigint) => money(laariToNumber(v));
const dash = (v: bigint) => (v === 0n ? <span className="text-[var(--muted)]">–</span> : m(v));

type Project = { id: string; code: string; name: string; completed_at: string | null };
type Dist = { project_id: string; created_at: string; profit_amount: string | number; distribution_lines: { amount: string | number }[] };
type Line = { lent: bigint; repaid: bigint; ret: bigint; share: bigint; paid: bigint; owed: bigint };

/**
 * Accounts for the company and each partner: per project, what was lent and
 * repaid, the return and profit share earned, what has been paid out, and what
 * is still owed (as the profit split explains it, one project at a time).
 */
export default async function AccountsPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role === "viewer") redirect("/");
  const [{ data: statement }, { data: contacts }, { data: projects }, { data: dists }, { data: accounts }, { data: capital }] = await Promise.all([
    s.supabase.from("partner_statement_v").select("contact_id, project_id, component, accrued, paid, outstanding"),
    s.supabase.from("contacts").select("id, name, kinds").or("kinds.cs.{partner},kinds.cs.{lender}").order("name"),
    s.supabase.from("projects").select("id, code, name, completed_at").order("code"),
    s.supabase.from("distributions").select("project_id, created_at, profit_amount, distribution_lines(amount)").order("created_at"),
    s.supabase.from("director_accounts_v").select("contact_id, balance").eq("book", s.book),
    s.supabase.rpc("company_capital_available"),
  ]);
  const rows = (statement ?? []) as StatementRow[];
  const proj = new Map(((projects ?? []) as Project[]).map((p) => [p.id, p]));
  const people = (contacts ?? []) as { id: string; name: string; kinds: string[] }[];
  const inAccount = new Map(((accounts ?? []) as { contact_id: string; balance: string | number }[]).map((a) => [a.contact_id, dbToLaari(a.balance)]));
  const companyMoney = dbToLaari(((capital ?? []) as { contact_id: string | null; available: string | number }[]).find((c) => c.contact_id === null)?.available);

  // each person's account, one line per project
  const accountOf = (cid: string) => {
    const lines = new Map<string, Line>();
    for (const r of rows.filter((x) => x.contact_id === cid)) {
      const l = lines.get(r.project_id) ?? { lent: 0n, repaid: 0n, ret: 0n, share: 0n, paid: 0n, owed: 0n };
      const accrued = dbToLaari(r.accrued), paid = dbToLaari(r.paid), owed = dbToLaari(r.outstanding);
      if (r.component === "principal") { l.lent += accrued; l.repaid += paid; }
      else { if (r.component === "financing_return") l.ret += accrued; else l.share += accrued; l.paid += paid; }
      l.owed += owed;
      lines.set(r.project_id, l);
    }
    return [...lines.entries()].sort(([a], [b]) => (proj.get(a)?.code ?? "").localeCompare(proj.get(b)?.code ?? ""));
  };
  const listed = people.filter((p) => p.kinds.includes("partner") || rows.some((r) => r.contact_id === p.id));

  // the company keeps what each completed project's profit leaves after the returns and shares (net of every adjustment)
  const byProject = new Map<string, { profit: bigint; shared: bigint }>();
  for (const d of (dists ?? []) as Dist[]) {
    const x = byProject.get(d.project_id) ?? { profit: 0n, shared: 0n };
    x.profit = dbToLaari(d.profit_amount); // the latest is the current profit
    x.shared += (d.distribution_lines ?? []).reduce((t, l) => t + dbToLaari(l.amount), 0n);
    byProject.set(d.project_id, x);
  }
  const companyLines = [...byProject.entries()].filter(([pid]) => proj.has(pid))
    .sort(([a], [b]) => (proj.get(a)?.code ?? "").localeCompare(proj.get(b)?.code ?? ""));
  const kept = companyLines.reduce((t, [, x]) => t + (x.profit - x.shared), 0n);

  const projectCell = (pid: string) => {
    const p = proj.get(pid);
    return p ? <Link href={`/projects/${p.id}?tab=split`} className="text-[var(--brand)] hover:underline"><span className="font-mono text-xs">{p.code}</span> {p.name}</Link> : "—";
  };
  const sum = (ls: [string, Line][], k: keyof Line) => ls.reduce((t, [, l]) => t + l[k], 0n);

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader title="Accounts" subtitle={`The company's and each partner's account, project by project · ${bookLabel(s.book)} book`}
        action={<Link href="/partners" className="text-sm font-medium text-[var(--brand)] hover:underline">Partners & financing</Link>} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Owed to partners and lenders" value={m(rows.reduce((t, r) => t + dbToLaari(r.outstanding), 0n))} hint="Loans, returns and shares not paid yet" />
        <Stat label="Kept by the company" value={m(kept)} hint="Its part of completed projects' profit" tone={kept > 0n ? "good" : "default"} />
        <Stat label="Company's own money" value={m(companyMoney)} hint="Bank and cash less everything it owes" />
      </div>

      <Card>
        <CardHeader title="Company" subtitle="Each completed project's profit: what goes to the partners as returns and shares, and what stays in the company" />
        {companyLines.length === 0 ? <Empty message="No project has been completed yet." /> : (
          <Table>
            <thead><tr><Th>Project</Th><Th right>Project profit</Th><Th right>To partners</Th><Th right>Company keeps</Th></tr></thead>
            <tbody>
              {companyLines.map(([pid, x]) => (
                <tr key={pid}>
                  <Td>{projectCell(pid)}</Td>
                  <Td right>{m(x.profit)}</Td>
                  <Td right>{m(x.shared)}</Td>
                  <Td right className="font-medium">{m(x.profit - x.shared)}</Td>
                </tr>
              ))}
              {companyLines.length > 1 && (
                <tr className="font-semibold">
                  <Td>Total</Td>
                  <Td right>{m(companyLines.reduce((t, [, x]) => t + x.profit, 0n))}</Td>
                  <Td right>{m(companyLines.reduce((t, [, x]) => t + x.shared, 0n))}</Td>
                  <Td right>{m(kept)}</Td>
                </tr>
              )}
            </tbody>
          </Table>
        )}
      </Card>

      {listed.length === 0 && <Card><Empty message="No partners or lenders yet." /></Card>}
      {listed.map((p) => {
        const ls = accountOf(p.id);
        const kept = inAccount.get(p.id) ?? 0n;
        const role = p.kinds.includes("partner") ? "Director" : "Lender";
        return (
          <Card key={p.id}>
            <CardHeader
              title={p.name}
              subtitle={`${role} · lent and repaid first, then the return and profit share${p.kinds.includes("partner") ? ` · in director's account ${m(kept)}` : ""}`}
              action={<Link href={`/partners/${p.id}`} className="text-xs font-medium text-[var(--brand)] hover:underline">Statement and payouts</Link>} />
            {ls.length === 0 ? <Empty message="Nothing on any project yet." /> : (
              <Table>
                <thead><tr><Th>Project</Th><Th right>Lent</Th><Th right>Repaid</Th><Th right>Financing return</Th><Th right>Profit share</Th><Th right>Paid out</Th><Th right>Still owed</Th></tr></thead>
                <tbody>
                  {ls.map(([pid, l]) => (
                    <tr key={pid}>
                      <Td>{projectCell(pid)}{!proj.get(pid)?.completed_at && <span className="block text-xs text-[var(--muted)]">not completed: return and share come on completion</span>}</Td>
                      <Td right>{dash(l.lent)}</Td>
                      <Td right>{dash(l.repaid)}</Td>
                      <Td right>{dash(l.ret)}</Td>
                      <Td right>{dash(l.share)}</Td>
                      <Td right>{dash(l.paid)}</Td>
                      <Td right className={l.owed > 0n ? "font-medium text-amber-700" : ""}>{m(l.owed)}</Td>
                    </tr>
                  ))}
                  {ls.length > 1 && (
                    <tr className="font-semibold">
                      <Td>Total</Td>
                      <Td right>{m(sum(ls, "lent"))}</Td><Td right>{m(sum(ls, "repaid"))}</Td><Td right>{m(sum(ls, "ret"))}</Td>
                      <Td right>{m(sum(ls, "share"))}</Td><Td right>{m(sum(ls, "paid"))}</Td><Td right>{m(sum(ls, "owed"))}</Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            )}
          </Card>
        );
      })}
    </div>
  );
}
