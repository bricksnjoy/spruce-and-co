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
  const [{ data: projects }, { data: statement }, { data: contacts }, { data: pending }] = await Promise.all([
    s.supabase.from("project_payouts_v").select("*").order("code"),
    s.supabase.from("partner_statement_v").select("contact_id, project_id, component, accrued, paid, outstanding"),
    s.supabase.from("contacts").select("id, name, kinds").or("kinds.cs.{partner},kinds.cs.{lender}").order("name"),
    s.supabase.from("transactions").select("id, date, number, contact_id, total_amount, created_at, transaction_lines(project_id, component, amount)")
      .eq("type", "payout").eq("is_draft", true).is("voided_at", null).order("date"),
  ]);
  const proj = (projects ?? []) as ProjectPayout[];
  const rows = (statement ?? []) as StatementRow[];
  const people = byPerson(rows);
  const names = new Map((contacts ?? []).map((c) => [c.id, c.name]));
  const kindOf = new Map((contacts ?? []).map((c) => [c.id, (c.kinds as string[]).filter((k) => k === "partner" || k === "lender")
    .map((k) => (k === "partner" ? "Capital Pool" : "Lender")).join(", ")]));
  const code = new Map(proj.map((p) => [p.id, p.code]));
  const blocked = new Map(proj.map((p) => [p.id, p.blocked]));
  const involved = proj.filter((p) => dbToLaari(p.financed) || dbToLaari(p.returns_outstanding) || p.completed_at);

  const principal = rows.filter((r) => r.component === "principal").reduce((t, r) => t + dbToLaari(r.outstanding), 0n);
  const returns = rows.filter((r) => r.component !== "principal").reduce((t, r) => t + dbToLaari(r.outstanding), 0n);
  const ready = rows.filter((r) => blocked.get(r.project_id) === false).reduce((t, r) => t + dbToLaari(r.outstanding), 0n);
  const waiting = rows.filter((r) => blocked.get(r.project_id) !== false).reduce((t, r) => t + dbToLaari(r.outstanding), 0n);
  const personIds = [...new Set([...(contacts ?? []).map((c) => c.id), ...people.keys()])];

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

      <Card>
        <CardHeader title="People" subtitle="Outstanding amounts, each component kept apart (§5)" />
        {personIds.length === 0 ? <Empty message="No partners or lenders yet. Add a lender on the Lenders page." /> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Type</Th><Th right>Principal</Th><Th right>Financing return</Th><Th right>Profit share</Th><Th right>Total owed</Th></tr></thead>
            <tbody>
              {personIds.map((id) => {
                const p = people.get(id);
                const total = p ? COMPONENTS.reduce((t, c) => t + p[c].outstanding, 0n) : 0n;
                return (
                  <tr key={id}>
                    <Td><Link href={`/partners/${id}`} className="font-medium text-[var(--brand)] hover:underline">{names.get(id) ?? "—"}</Link></Td>
                    <Td className="text-xs text-[var(--muted)]">{kindOf.get(id) ?? ""}</Td>
                    {COMPONENTS.map((c) => <Td key={c} right>{m(p?.[c].outstanding ?? 0n)}</Td>)}
                    <Td right className="font-semibold">{m(total)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

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
