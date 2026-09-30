import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession, type Session } from "@/server/session";
import { date, money, pct, titleize, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { docStatus, type DocBalance } from "@/lib/doc-status";
import { STAGE_LABEL, type ProjectFigures } from "@/lib/project-figures";
import { BudgetEditor, type BudgetLine } from "./budget-editor";
import { VariationRows, NewVariation, type VariationRow } from "./variation-forms";
import { BillingPlan, type Stage } from "./billing-plan";
import { ArchiveButton } from "./archive-button";

export const dynamic = "force-dynamic";

const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v)));
const TABS: [string, string][] = [["overview", "Overview"], ["value", "Value & budget"], ["variations", "Variations"], ["billing", "Billing plan"], ["transactions", "Transactions"]];

export default async function ProjectPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: f } = await s.supabase.from("project_list_v").select("*").eq("id", id).maybeSingle();
  if (!f) notFound();
  const p = f as ProjectFigures;
  const active = TABS.some(([k]) => k === tab) ? tab! : "overview";
  const writer = canWrite(s.role);

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <Link href="/projects" className="text-xs text-[var(--muted)] hover:underline">← Projects</Link>
      </div>
      <PageHeader title={p.name}
        subtitle={`${p.code}${p.customer_name ? ` · ${p.customer_name}` : ""} · ${STAGE_LABEL[p.stage] ?? p.stage}`}
        action={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {p.customer_id && <Link href={`/sales/customers/${p.customer_id}`} className="font-medium text-[var(--brand)] hover:underline">Customer</Link>}
            {s.book === "live" && <Link href={`/projects/${id}/legacy`} className="font-medium text-[var(--brand)] hover:underline">Old view</Link>}
            {writer && <Link href={`/expenses/new?type=bill&project=${id}`} className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-medium hover:bg-[var(--brand-soft)]">New bill</Link>}
            {writer && p.customer_id && <Link href={`/sales/new?type=invoice&project=${id}`} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 font-medium text-white hover:bg-[var(--brand-hover)]">New invoice</Link>}
            {writer && <Link href={`/projects/${id}/edit`} className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-medium hover:bg-[var(--brand-soft)]">Edit</Link>}
            {writer && <ArchiveButton id={id} archived={Boolean(p.archived_at)} />}
          </div>
        } />

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/projects/${id}?tab=${k}`}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${active === k ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>{l}</Link>
        ))}
      </div>

      {active === "overview" && <Overview p={p} />}
      {active === "value" && <Value s={s} p={p} writer={writer} />}
      {active === "variations" && <Variations s={s} p={p} writer={writer} />}
      {active === "billing" && <Billing s={s} p={p} writer={writer} />}
      {active === "transactions" && <Transactions s={s} id={id} />}
    </div>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "good" }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={`mt-2 text-xl font-semibold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-700" : ""}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
    </Card>
  );
}

function Overview({ p }: { p: ProjectFigures }) {
  const oub = dbToLaari(p.over_under_billing);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Contract value" value={m(p.revised)} hint={`${m(p.original)} original · ${m(p.variations)} variations`} />
        <Figure label="Billed" value={m(p.billed)} hint={`${pct(Number(p.billed_pct), 1)} · ${m(p.remaining_to_bill)} left to bill`} />
        <Figure label="Collected" value={m(p.collected)} hint={`Client owes ${m(p.client_balance)}${dbToLaari(p.retention_held) ? ` · retention ${m(p.retention_held)}` : ""}`} />
        <Figure label="Cost to date" value={m(p.cost_to_date)} hint={`Budget ${m(p.revised_budget)}`} />
        <Figure label="Forecast final cost" value={m(p.forecast_final_cost)} hint={`${m(p.forecast_to_complete)} still to spend`} />
        <Figure label="Forecast profit" value={m(p.forecast_profit)} hint={`Margin ${pct(Number(p.margin_pct), 1)}`} tone={dbToLaari(p.forecast_profit) < 0n ? "bad" : undefined} />
        <Figure label="Complete" value={pct(Number(p.pct_complete), 1)} hint={`Cost to date ÷ forecast final cost · earned ${m(p.earned)}`} />
        <Figure label={oub >= 0n ? "Billed ahead of work" : "Work ahead of billing"} value={m(laariToNumber(oub < 0n ? -oub : oub))}
          hint={oub >= 0n ? "Over-billing (a liability until earned)" : "Under-billing (earned, not yet invoiced)"} />
      </div>
      <Card className="px-5 py-4 text-sm">
        <p><span className="text-[var(--muted)]">Actual profit so far</span> <strong className="tabular-nums">{m(p.actual_profit)}</strong>
          <span className="text-xs text-[var(--muted)]"> — revenue less direct job costs{dbToLaari(p.bad_debts) ? ` and ${m(p.bad_debts)} written off` : ""}</span></p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Revenue is recognised {p.recognition_method === "poc" ? "by percentage of completion" : p.recognition_method === "billing" ? "as it is billed" : "by the company default"}.
          {p.start_date ? ` Started ${date(p.start_date)}.` : ""}{p.end_date ? ` Due to finish ${date(p.end_date)}.` : ""}
        </p>
      </Card>
    </div>
  );
}

async function Value({ s, p, writer }: { s: Session; p: ProjectFigures; writer: boolean }) {
  const [{ data }, { data: committedRows }] = await Promise.all([
    s.supabase.from("budget_lines").select("id, description, budget_category, budget_amount, revised_amount, forecast_to_complete").eq("project_id", p.id).order("created_at"),
    s.supabase.from("committed_cost_v").select("budget_category, committed").eq("project_id", p.id),
  ]);
  const committed = new Map<string, bigint>((committedRows ?? []).map((r) => [r.budget_category, dbToLaari(r.committed)]));
  const costs = [...(p.costs ?? [])].sort((a, b) => a.category.localeCompare(b.category));
  for (const cat of committed.keys()) if (!costs.some((c) => c.category === cat)) costs.push({ category: cat, actual: 0, budget: 0, revised: 0, forecast_to_complete: 0 });
  // budget alerts: a category past 80% or 100% of its revised budget, counting open orders
  const alerts = costs.map((c) => {
    const used = dbToLaari(c.actual) + (committed.get(c.category) ?? 0n);
    const rev = dbToLaari(c.revised);
    return { cat: c.category, used, rev, level: rev > 0n ? (used * 100n >= rev * 100n ? 100 : used * 100n >= rev * 80n ? 80 : 0) : used > 0n ? 100 : 0 };
  }).filter((a) => a.level > 0);
  return (
    <div className="space-y-5">
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a) => (
            <p key={a.cat} className={`rounded-lg px-4 py-2 text-sm ${a.level === 100 ? "border border-red-200 bg-red-50 text-red-800" : "border border-amber-300 bg-amber-50 text-amber-900"}`}>
              {titleize(a.cat)}: {money(laariToNumber(a.used))} spent or ordered {a.rev > 0n ? `of a ${money(laariToNumber(a.rev))} budget (${a.level === 100 ? "over budget" : "past 80%"})` : "with no budget set"}.
            </p>
          ))}
        </div>
      )}
      <Card>
        <CardHeader title="Budget against actual" subtitle="Actual cost from the ledger; committed is open purchase orders; forecast to complete is your estimate, or what is left of the budget" />
        {costs.length === 0 ? <Empty message="No budget or costs yet." /> : (
          <Table>
            <thead><tr><Th>Category</Th><Th right>Budget</Th><Th right>Revised</Th><Th right>Actual</Th><Th right>Committed</Th><Th right>To complete</Th><Th right>Forecast final</Th><Th right>Variance</Th></tr></thead>
            <tbody>
              {costs.map((c) => {
                const final = dbToLaari(c.actual) + dbToLaari(c.forecast_to_complete);
                const variance = dbToLaari(c.revised) - final;
                return (
                  <tr key={c.category}>
                    <Td>{titleize(c.category)}</Td>
                    <Td right>{m(c.budget)}</Td><Td right>{m(c.revised)}</Td><Td right>{m(c.actual)}</Td>
                    <Td right>{committed.get(c.category) ? money(laariToNumber(committed.get(c.category)!)) : ""}</Td>
                    <Td right>{m(c.forecast_to_complete)}</Td><Td right>{money(laariToNumber(final))}</Td>
                    <Td right className={variance < 0n ? "text-red-700" : ""}>{money(laariToNumber(variance))}</Td>
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <Td>Total</Td><Td right>{m(p.budget)}</Td><Td right>{m(p.revised_budget)}</Td><Td right>{m(p.cost_to_date)}</Td>
                <Td right>{money(laariToNumber([...committed.values()].reduce((a, v) => a + v, 0n)))}</Td>
                <Td right>{m(p.forecast_to_complete)}</Td><Td right>{m(p.forecast_final_cost)}</Td>
                <Td right>{money(laariToNumber(dbToLaari(p.revised_budget) - dbToLaari(p.forecast_final_cost)))}</Td>
              </tr>
            </tbody>
          </Table>
        )}
      </Card>
      <BudgetEditor projectId={p.id} lines={(data ?? []) as BudgetLine[]} canEdit={writer} />
    </div>
  );
}

async function Variations({ s, p, writer }: { s: Session; p: ProjectFigures; writer: boolean }) {
  const { data } = await s.supabase.from("variations")
    .select("id, number, ref, title, description, status, amount, raised_date, approved_date, time_impact_days, client_reference")
    .eq("project_id", p.id).order("number");
  const rows = (data ?? []) as VariationRow[];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Figure label="Original contract" value={m(p.original)} />
        <Figure label="Approved variations" value={m(p.variations)} />
        <Figure label="Revised contract" value={m(p.revised)} />
      </div>
      {writer && <NewVariation projectId={p.id} />}
      <Card>
        <CardHeader title="Variations register" subtitle="Only approved variations change the contract value" />
        {rows.length === 0 ? <Empty message="No variations raised." /> : <VariationRows projectId={p.id} rows={rows} canEdit={writer} />}
      </Card>
    </div>
  );
}

async function Billing({ s, p, writer }: { s: Session; p: ProjectFigures; writer: boolean }) {
  const { data } = await s.supabase.from("billing_stages").select("id, name, basis, value, due_event, invoice_id, sort_order").eq("project_id", p.id).order("sort_order");
  return <BillingPlan projectId={p.id} revised={String(p.revised)} stages={(data ?? []) as Stage[]} canEdit={writer} />;
}

async function Transactions({ s, id }: { s: Session; id: string }) {
  // documents headed to the project, and any whose lines post to it
  const [{ data: byHeader }, { data: byLine }] = await Promise.all([
    s.supabase.from("transactions").select("id").eq("project_id", id),
    s.supabase.from("journal_lines").select("transaction_id").eq("project_id", id),
  ]);
  const ids = [...new Set([...(byHeader ?? []).map((r) => r.id), ...(byLine ?? []).map((r) => r.transaction_id)])];
  const { data } = ids.length
    ? await s.supabase.from("document_balances_v").select("id, type, number, date, due_date, total, applied, balance, is_draft, sent_at, voided_at, contact_id").in("id", ids).order("date", { ascending: false })
    : { data: [] };
  const t = today();
  const rows = (data ?? []) as (DocBalance & { id: string; number: string | null; date: string })[];
  return (
    <Card>
      {rows.length === 0 ? <Empty message="Nothing has been posted to this project yet." /> : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Type</Th><Th>No.</Th><Th right>Total</Th><Th right>Status</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.voided_at ? "text-[var(--muted)] line-through" : ""}>
                <Td className="whitespace-nowrap">{date(r.date)}</Td>
                <Td>{titleize(r.type)}</Td>
                <Td className="font-mono text-xs">{r.number ?? "—"}</Td>
                <Td right>{m(r.total)}</Td>
                <Td right><Badge value={docStatus(r, t)} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
