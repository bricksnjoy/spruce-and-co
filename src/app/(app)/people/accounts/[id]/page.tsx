import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Stat, Table, Th, Td } from "@/components/ui";
import { getSession } from "@/server/session";
import { ACCOUNT_LABEL, loadAccounts, type PartnerLine } from "@/server/accounts";
import { money } from "@/lib/format";
import { laariToNumber } from "@/lib/money";

export const dynamic = "force-dynamic";
const m = (v: bigint) => money(laariToNumber(v));
const dash = (v: bigint) => (v === 0n ? <span className="text-[var(--muted)]">–</span> : m(v));

/** One account, project by project: a partner's lent, repaid, return, share, paid and owed; the company's profit kept. */
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role === "viewer") redirect("/");
  const { company, people, proj } = await loadAccounts(s);
  const a = id === "company" ? company : people.find((p) => p.id === id);
  if (!a) notFound();

  const projectCell = (pid: string) => {
    const p = proj.get(pid);
    return p ? <Link href={`/projects/${p.id}?tab=split`} className="text-[var(--brand)] hover:underline"><span className="font-mono text-xs">{p.code}</span> {p.name}</Link> : "—";
  };
  const back = <Link href="/people/accounts" className="text-xs text-[var(--muted)] hover:underline">← Accounts</Link>;

  if (a.kind === "company") {
    const ls = a.companyLines;
    const kept = ls.reduce((t, [, x]) => t + (x.profit - x.shared), 0n);
    return (
      <div className="max-w-5xl space-y-5">
        <div>{back}</div>
        <PageHeader title="Company account" subtitle="Spruce & Co · each completed project's profit, what goes to the partners and what the company keeps" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label="Company's own money" value={m(a.balance)} hint="Bank and cash less everything it owes" />
          <Stat label="Kept from projects" value={m(kept)} hint="Its part of completed projects' profit" tone={kept > 0n ? "good" : "default"} />
        </div>
        <Card>
          <CardHeader title="Projects" />
          {ls.length === 0 ? <Empty message="No project has been completed yet." /> : (
            <Table>
              <thead><tr><Th>Project</Th><Th right>Project profit</Th><Th right>To partners</Th><Th right>Company keeps</Th></tr></thead>
              <tbody>
                {ls.map(([pid, x]) => (
                  <tr key={pid}>
                    <Td>{projectCell(pid)}</Td><Td right>{m(x.profit)}</Td><Td right>{m(x.shared)}</Td>
                    <Td right className="font-medium">{m(x.profit - x.shared)}</Td>
                  </tr>
                ))}
                {ls.length > 1 && (
                  <tr className="font-semibold">
                    <Td>Total</Td>
                    <Td right>{m(ls.reduce((t, [, x]) => t + x.profit, 0n))}</Td>
                    <Td right>{m(ls.reduce((t, [, x]) => t + x.shared, 0n))}</Td>
                    <Td right>{m(kept)}</Td>
                  </tr>
                )}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    );
  }

  const ls = a.partnerLines;
  const sum = (k: keyof PartnerLine) => ls.reduce((t, [, l]) => t + l[k], 0n);
  return (
    <div className="max-w-5xl space-y-5">
      <div>{back}</div>
      <PageHeader title={a.name} subtitle={`${ACCOUNT_LABEL[a.kind]} · loans are repaid first, then the return and profit share`}
        action={<Link href={`/partners/${a.id}`} className="text-sm font-medium text-[var(--brand)] hover:underline">Statement and payouts</Link>} />
      <div className={`grid gap-4 ${a.kind === "director" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Stat label="Balance" value={m(a.balance)} hint={a.kind === "director" ? "Owed on projects, plus the director's account" : "Owed on projects"} />
        <Stat label="Still owed on projects" value={m(sum("owed"))} tone={sum("owed") > 0n ? "warn" : "default"} />
        {a.kind === "director" && <Stat label="In director's account" value={m(a.inAccount)} hint="Kept in the company" />}
      </div>
      <Card>
        <CardHeader title="Projects" />
        {ls.length === 0 ? <Empty message="Nothing on any project yet." /> : (
          <Table>
            <thead><tr><Th>Project</Th><Th right>Lent</Th><Th right>Repaid</Th><Th right>Financing return</Th><Th right>Profit share</Th><Th right>Paid out</Th><Th right>Still owed</Th></tr></thead>
            <tbody>
              {ls.map(([pid, l]) => (
                <tr key={pid}>
                  <Td>{projectCell(pid)}{!proj.get(pid)?.completed_at && <span className="block text-xs text-[var(--muted)]">not completed: return and share come on completion</span>}</Td>
                  <Td right>{dash(l.lent)}</Td><Td right>{dash(l.repaid)}</Td><Td right>{dash(l.ret)}</Td>
                  <Td right>{dash(l.share)}</Td><Td right>{dash(l.paid)}</Td>
                  <Td right className={l.owed > 0n ? "font-medium text-amber-700" : ""}>{m(l.owed)}</Td>
                </tr>
              ))}
              {ls.length > 1 && (
                <tr className="font-semibold">
                  <Td>Total</Td>
                  <Td right>{m(sum("lent"))}</Td><Td right>{m(sum("repaid"))}</Td><Td right>{m(sum("ret"))}</Td>
                  <Td right>{m(sum("share"))}</Td><Td right>{m(sum("paid"))}</Td><Td right>{m(sum("owed"))}</Td>
                </tr>
              )}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
