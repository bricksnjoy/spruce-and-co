import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardHeader, Empty, PageHeader, Stat, Table, Th, Td } from "@/components/ui";
import { PayoutForm, type OwedRow } from "@/components/partners/forms";
import { canWrite, getSession } from "@/server/session";
import { date, money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { COMPONENT_LABEL, COMPONENTS, type ProjectPayout, type StatementRow } from "@/lib/partners";

export const dynamic = "force-dynamic";
const m = (v: number | string | bigint | null | undefined) => money(laariToNumber(typeof v === "bigint" ? v : dbToLaari(v ?? 0)));

/** One person's statement (§9): principal, financing return and profit share per project — accrued, paid, outstanding. */
export default async function PartnerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ data: person }, { data: statement }, { data: projects }, { data: banks }, { data: payouts }] = await Promise.all([
    s.supabase.from("contacts").select("id, name, kinds, phone, email").eq("id", id).maybeSingle(),
    s.supabase.from("partner_statement_v").select("contact_id, project_id, component, accrued, paid, outstanding").eq("contact_id", id),
    s.supabase.from("project_payouts_v").select("id, code, name, stage, blocked, blocked_reason"),
    s.supabase.from("accounts").select("id, code, name").in("subtype", ["bank", "cash"]).eq("active", true).order("code"),
    s.supabase.from("transactions").select("id, date, number, total_amount, is_draft, voided_at, void_reason, approval_status, reference, transaction_lines(project_id, component, amount)")
      .eq("type", "payout").eq("contact_id", id).order("date", { ascending: false }),
  ]);
  if (!person) notFound();
  const rows = (statement ?? []) as StatementRow[];
  const proj = new Map(((projects ?? []) as Pick<ProjectPayout, "id" | "code" | "name" | "stage" | "blocked" | "blocked_reason">[]).map((p) => [p.id, p]));
  const projectIds = [...new Set(rows.map((r) => r.project_id))].sort((a, b) => (proj.get(a)?.code ?? "").localeCompare(proj.get(b)?.code ?? ""));
  const cell = (pid: string, c: string) => rows.find((r) => r.project_id === pid && r.component === c);
  const sum = (c: string, k: "accrued" | "paid" | "outstanding") => rows.filter((r) => r.component === c).reduce((t, r) => t + dbToLaari(r[k]), 0n);
  const owed: OwedRow[] = rows.filter((r) => dbToLaari(r.outstanding) > 0n).map((r) => ({
    project_id: r.project_id, code: proj.get(r.project_id)?.code ?? "—", component: r.component, outstanding: String(r.outstanding),
    blocked: proj.get(r.project_id)?.blocked ?? true, reason: proj.get(r.project_id)?.blocked_reason ?? null,
  })).sort((a, b) => a.code.localeCompare(b.code) || COMPONENTS.indexOf(a.component as never) - COMPONENTS.indexOf(b.component as never));

  return (
    <div className="max-w-6xl space-y-5">
      <div><Link href="/partners" className="text-xs text-[var(--muted)] hover:underline">← Partners & financing</Link></div>
      <PageHeader title={person.name} subtitle={`Statement · ${(person.kinds as string[]).filter((k) => k === "partner" || k === "lender").map((k) => k === "partner" ? "Capital Pool member" : "External lender").join(", ") || "Contact"}`} />
      <div className="grid gap-4 sm:grid-cols-3">
        {COMPONENTS.map((c) => (
          <Stat key={c} label={`${COMPONENT_LABEL[c]} owed`} value={m(sum(c, "outstanding"))} hint={`${m(sum(c, "accrued"))} accrued · ${m(sum(c, "paid"))} paid`} />
        ))}
      </div>

      <Card>
        <CardHeader title="By project" subtitle="The three components are never merged" />
        {projectIds.length === 0 ? <Empty message="Nothing financed, earned or paid yet." /> : (
          <Table>
            <thead><tr><Th>Project</Th><Th>Component</Th><Th right>Accrued</Th><Th right>Paid</Th><Th right>Outstanding</Th><Th>Payouts</Th></tr></thead>
            <tbody>
              {projectIds.flatMap((pid) => COMPONENTS.filter((c) => cell(pid, c)).map((c, i) => {
                const r = cell(pid, c)!;
                const p = proj.get(pid);
                return (
                  <tr key={`${pid}-${c}`}>
                    <Td>{i === 0 && <Link href={`/projects/${pid}?tab=financing`} className="text-[var(--brand)] hover:underline"><span className="font-mono text-xs">{p?.code}</span> {p?.name}</Link>}</Td>
                    <Td>{COMPONENT_LABEL[c]}</Td>
                    <Td right>{m(r.accrued)}</Td><Td right>{m(r.paid)}</Td><Td right className="font-medium">{m(r.outstanding)}</Td>
                    <Td>{i === 0 && (p?.blocked ? <span className="text-xs text-red-700">{p.blocked_reason}</span> : <span className="text-xs text-emerald-700">Released</span>)}</Td>
                  </tr>
                );
              }))}
            </tbody>
          </Table>
        )}
      </Card>

      {canWrite(s.role) && owed.length > 0 && (
        <Card>
          <CardHeader title="Pay out" subtitle={s.role === "admin" ? "As an admin, your payout is approved and paid at once" : "Your payout goes to an admin for approval before it is paid"} />
          <PayoutForm contactId={id} banks={banks ?? []} rows={owed} isAdmin={s.role === "admin"} />
        </Card>
      )}

      <Card>
        <CardHeader title="Payouts" />
        {(payouts ?? []).length === 0 ? <Empty message="No payouts yet." /> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>No.</Th><Th>Lines</Th><Th right>Amount</Th><Th right>Status</Th></tr></thead>
            <tbody>
              {(payouts ?? []).map((t) => (
                <tr key={t.id} className={t.voided_at ? "text-[var(--muted)]" : ""}>
                  <Td className="whitespace-nowrap">{date(t.date)}</Td>
                  <Td className="font-mono text-xs">{t.number}</Td>
                  <Td className="text-xs">{(t.transaction_lines ?? []).map((l, i) => (
                    <div key={i}>{proj.get(l.project_id!)?.code ?? "—"} · {COMPONENT_LABEL[l.component!] ?? l.component} · {m(l.amount)}</div>))}
                    {t.voided_at && t.void_reason && <div className="text-[var(--muted)]">Not paid: {t.void_reason}</div>}</Td>
                  <Td right>{m(t.total_amount)}</Td>
                  <Td right><Badge value={t.voided_at ? "void" : t.is_draft ? "awaiting_approval" : "paid"} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
