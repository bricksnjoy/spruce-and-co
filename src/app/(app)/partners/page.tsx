import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardHeader, Empty, PageHeader, Stat, Table, Th, Td } from "@/components/ui";
import { PayoutApproval } from "@/components/partners/forms";
import { canWrite, getSession } from "@/server/session";
import { date, money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";
import { byPerson, COMPONENT_LABEL, COMPONENTS, type ProjectPayout, type StatementRow } from "@/lib/partners";

export const dynamic = "force-dynamic";
const m = (v: number | string | bigint | null | undefined) => money(laariToNumber(typeof v === "bigint" ? v : dbToLaari(v ?? 0)));

/** Partners & Financing (§5, §6, §9): who financed what, what each person is owed, and what can be paid. */
export default async function PartnersPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data: projects }, { data: statement }, { data: contacts }, { data: pending }, { data: capital }] = await Promise.all([
    s.supabase.from("project_payouts_v").select("*").order("code"),
    s.supabase.from("partner_statement_v").select("contact_id, project_id, component, accrued, paid, outstanding"),
    s.supabase.from("contacts").select("id, name, kinds").or("kinds.cs.{partner},kinds.cs.{lender}").order("name"),
    s.supabase.from("transactions").select("id, date, number, contact_id, total_amount, created_at, transaction_lines(project_id, component, amount)")
      .eq("type", "payout").eq("is_draft", true).is("voided_at", null).order("date"),
    // the company's own money is part of the Capital Pool too
    s.supabase.rpc("company_capital_available"),
  ]);
  const companyMoney = dbToLaari(((capital ?? []) as { contact_id: string | null; available: string | number }[]).find((c) => c.contact_id === null)?.available);
  const proj = (projects ?? []) as ProjectPayout[];
  const rows = (statement ?? []) as StatementRow[];
  const people = byPerson(rows);
  const names = new Map((contacts ?? []).map((c) => [c.id, c.name]));
  const code = new Map(proj.map((p) => [p.id, p.code]));
  const blocked = new Map(proj.map((p) => [p.id, p.blocked]));
  const involved = proj.filter((p) => dbToLaari(p.financed) || dbToLaari(p.returns_outstanding) || p.completed_at);

  const principal = rows.filter((r) => r.component === "principal").reduce((t, r) => t + dbToLaari(r.outstanding), 0n);
  const returns = rows.filter((r) => r.component !== "principal").reduce((t, r) => t + dbToLaari(r.outstanding), 0n);
  const ready = rows.filter((r) => blocked.get(r.project_id) === false).reduce((t, r) => t + dbToLaari(r.outstanding), 0n);
  const waiting = rows.filter((r) => blocked.get(r.project_id) !== false).reduce((t, r) => t + dbToLaari(r.outstanding), 0n);
  const personIds = [...new Set([...(contacts ?? []).map((c) => c.id), ...people.keys()])];
  // Capital Pool members and external lenders are listed apart; a member who also lends is listed with the pool
  const isPool = new Set((contacts ?? []).filter((c) => (c.kinds as string[]).includes("partner")).map((c) => c.id));
  const pool = personIds.filter((id) => isPool.has(id));
  const lenders = personIds.filter((id) => !isPool.has(id));
  const readyFor = (id: string) => rows.filter((r) => r.contact_id === id && blocked.get(r.project_id) === false).reduce((t, r) => t + dbToLaari(r.outstanding), 0n);

  const peopleTable = (title: string, subtitle: string, ids: string[], empty: string, company = false) => (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {ids.length === 0 && !company ? <Empty message={empty} /> : (
        <Table>
          <thead><tr><Th>Name</Th><Th right>Principal</Th><Th right>Financing return</Th><Th right>Profit share</Th><Th right>Total owed</Th><Th right>Ready to take</Th></tr></thead>
          <tbody>
            {ids.map((id) => {
              const p = people.get(id);
              const total = p ? COMPONENTS.reduce((t, c) => t + p[c].outstanding, 0n) : 0n;
              return (
                <tr key={id}>
                  <Td><Link href={`/partners/${id}`} className="font-medium text-[var(--brand)] hover:underline">{names.get(id) ?? "—"}</Link></Td>
                  {COMPONENTS.map((c) => <Td key={c} right>{m(p?.[c].outstanding ?? 0n)}</Td>)}
                  <Td right className="font-semibold">{m(total)}</Td>
                  <Td right className={readyFor(id) > 0n ? "text-emerald-700" : "text-[var(--muted)]"}>{m(readyFor(id))}</Td>
                </tr>
              );
            })}
            {company && (
              <tr>
                <Td><span className="font-medium">Company</span><span className="block text-xs text-[var(--muted)]">its own money: bank, cash and payments not yet banked, less what members are owed</span></Td>
                <Td right className="text-[var(--muted)]">—</Td><Td right className="text-[var(--muted)]">—</Td><Td right className="text-[var(--muted)]">—</Td><Td right className="text-[var(--muted)]">—</Td>
                <Td right className={companyMoney > 0n ? "text-emerald-700" : "text-[var(--muted)]"}>{m(companyMoney)}</Td>
              </tr>
            )}
            {ids.length + (company ? 1 : 0) > 1 && (
              <tr className="font-semibold">
                <Td>Total</Td>
                {COMPONENTS.map((c) => <Td key={c} right>{m(ids.reduce((t, id) => t + (people.get(id)?.[c].outstanding ?? 0n), 0n))}</Td>)}
                <Td right>{m(ids.reduce((t, id) => t + COMPONENTS.reduce((x, c) => x + (people.get(id)?.[c].outstanding ?? 0n), 0n), 0n))}</Td>
                <Td right>{m(ids.reduce((t, id) => t + readyFor(id), 0n) + (company ? companyMoney : 0n))}</Td>
              </tr>
            )}
          </tbody>
        </Table>
      )}
    </Card>
  );

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader title="Partners & financing" subtitle={`Capital Pool, lenders, profit shares and payouts · ${bookLabel(s.book)} book`}
        action={<div className="flex gap-3 text-sm">
          <Link href="/partners/lenders" className="font-medium text-[var(--brand)] hover:underline">Lenders</Link>
          <Link href="/partners/distributions" className="font-medium text-[var(--brand)] hover:underline">Distribution history</Link>
          <Link href="/settings/profit-share" className="font-medium text-[var(--brand)] hover:underline">Profit-share schemes</Link>
        </div>} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Principal outstanding" value={m(principal)} hint="Loans and Capital Pool money not yet repaid" />
        <Stat label="Returns and shares owed" value={m(returns)} hint="Financing returns and profit shares posted, not paid" />
        <Stat label="Ready to pay" value={m(ready)} hint="On completed projects the client has fully paid" tone={ready > 0n ? "good" : "default"} />
        <Stat label="Blocked" value={m(waiting)} hint="Waiting for completion or the client to pay" tone={waiting > 0n ? "warn" : "default"} />
      </div>

      {(pending ?? []).length > 0 && (
        <Card>
          <CardHeader title="Payouts awaiting approval" subtitle="An admin (the MD) approves each payout before it is paid" />
          <Table>
            <thead><tr><Th>Date</Th><Th>No.</Th><Th>To</Th><Th>Lines</Th><Th right>Amount</Th><Th right> </Th></tr></thead>
            <tbody>
              {(pending ?? []).map((t) => (
                <tr key={t.id}>
                  <Td className="whitespace-nowrap">{date(t.date)}</Td>
                  <Td className="font-mono text-xs">{t.number}</Td>
                  <Td><Link href={`/partners/${t.contact_id}`} className="text-[var(--brand)] hover:underline">{names.get(t.contact_id!) ?? "—"}</Link></Td>
                  <Td className="text-xs">{(t.transaction_lines ?? []).map((l, i) => (
                    <div key={i}>{code.get(l.project_id!) ?? "—"} · {COMPONENT_LABEL[l.component!] ?? l.component} · {m(l.amount)}</div>))}</Td>
                  <Td right>{m(t.total_amount)}</Td>
                  <Td right>{canWrite(s.role) && <PayoutApproval id={t.id} isAdmin={s.role === "admin"} />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {peopleTable("Capital Pool", "Each member and the company. What each member is owed, each component kept apart (§5); ready to take is what has been released, and with the company's own money it is what the pool can finance a project with.",
        pool, "No Capital Pool members yet.", true)}
      {peopleTable("Lenders", "External lenders: their loans and returns, kept apart from the Capital Pool", lenders, "No lenders yet. Add one on the Lenders page.")}

      <Card>
        <CardHeader title="Projects" subtitle="Financing received, what is still owed, and whether payouts are released" />
        {involved.length === 0 ? <Empty message="No project has financing or a profit split yet." /> : (
          <Table>
            <thead><tr><Th>Project</Th><Th>Stage</Th><Th right>Financed</Th><Th right>Principal owed</Th><Th right>Returns owed</Th><Th right>Split on profit</Th><Th>Payouts</Th></tr></thead>
            <tbody>
              {involved.map((p) => (
                <tr key={p.id}>
                  <Td><Link href={`/projects/${p.id}?tab=financing`} className="text-[var(--brand)] hover:underline"><span className="font-mono text-xs">{p.code}</span> {p.name}</Link></Td>
                  <Td><Badge value={p.stage} /></Td>
                  <Td right>{m(p.financed)}</Td>
                  <Td right>{m(p.principal_outstanding)}</Td>
                  <Td right>{m(p.returns_outstanding)}</Td>
                  <Td right>{p.split_profit == null ? <span className="text-[var(--muted)]">not split</span> : m(p.split_profit)}</Td>
                  <Td>{p.blocked ? <span className="text-xs text-red-700">{p.blocked_reason}</span> : <span className="text-xs text-emerald-700">Released</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
