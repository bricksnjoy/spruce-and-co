import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  Card, CardHeader, PageHeader, Stat, Badge, Table, Th, Td, Empty,
} from "@/components/ui";
import { extractionAvailable } from "@/lib/extract-bill";
import { money, num, pct } from "@/lib/format";
import type { ProjectPnl } from "@/lib/types";
import { StatusBar } from "./status-bar";
import { VariationsPanel } from "./variations-panel";
import { BillsPanel } from "./bills-panel";
import { InvestmentsPanel, type InvestmentRow } from "./investments-panel";
import { ProfitShareCard, type ShareLine } from "./profit-share-card";
import { ProjectViews } from "./project-views";
import { ArchiveButton } from "./archive-button";
import { QuotationsPanel, type ProjectDoc } from "./quotations-panel";
import { VIEW_COOKIE, type ProjectView } from "@/lib/project-view";

export const dynamic = "force-dynamic";
// bill reading waits on Google, and retries when it is busy
export const maxDuration = 60;

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: pnlRow } = await supabase
    .from("project_pnl")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!pnlRow) notFound();
  const p = pnlRow as ProjectPnl;

  const [
    { data: project },
    { data: budget },
    { data: bills },
    { data: splits },
    { data: variations },
    { data: categories },
    { data: company },
    { data: financingSources },
    { data: directory },
    { data: poolSummary },
    { data: dispositions },
    { data: investorBalances },
    { data: projectQuotes },
    { data: projectInvoices },
  ] = await Promise.all([
    supabase.from("projects").select("*, clients(name)").eq("id", id).single(),
    supabase.from("budget_lines").select("*, cost_categories(name)").eq("project_id", id),
    supabase.from("bills")
      .select("*, vendors(name, tin), cost_categories(name)")
      .eq("project_id", id)
      .order("issue_date", { ascending: false }),
    supabase
      .from("project_profit_split")
      .select("*")
      .eq("project_id", id)
      .order("sort_order"),
    supabase.from("variations").select("*").eq("project_id", id).order("raised_date"),
    supabase.from("cost_categories").select("id, name").order("sort_order"),
    supabase.from("company").select("taxable_activity_no, gst_registered").eq("id", true).maybeSingle(),
    supabase
      .from("project_financing_sources")
      .select("id, name, source_type, investor_id, amount, funded_on")
      .eq("project_id", id)
      .in("source_type", ["investor", "capital_pool"])
      .order("funded_on", { ascending: false }),
    supabase.from("investors").select("id, name").order("name"),
    // company retained profit accrued, and all company capital already put into
    // projects — the difference is what is free to reinvest
    supabase.from("finance_summary").select("pool_total, pool_deployed").maybeSingle(),
    supabase
      .from("internal_account_entries")
      .select("share_name, disposition")
      .eq("project_id", id)
      .eq("entry_type", "accrual"),
    supabase
      .from("investor_balances")
      .select("investor_id, paid_at")
      .eq("project_id", id),
    supabase
      .from("quotations")
      .select("id, number, issue_date, status, title")
      .eq("project_id", id)
      .order("seq", { ascending: false }),
    supabase
      .from("invoices")
      .select("id, number, issue_date, status, title, quotation_id")
      .eq("project_id", id)
      .order("seq"),
  ]);

  // what each quotation and invoice comes to, with tax
  const [{ data: qTotals }, { data: iTotals }] = await Promise.all([
    projectQuotes?.length
      ? supabase.from("quotation_totals").select("quotation_id, total").in("quotation_id", projectQuotes.map((q) => q.id))
      : Promise.resolve({ data: [] as { quotation_id: string; total: number }[] }),
    projectInvoices?.length
      ? supabase.from("invoice_totals").select("invoice_id, total").in("invoice_id", projectInvoices.map((i) => i.id))
      : Promise.resolve({ data: [] as { invoice_id: string; total: number }[] }),
  ]);
  const qTotal = new Map((qTotals ?? []).map((t) => [t.quotation_id, num(t.total)]));
  const iTotal = new Map((iTotals ?? []).map((t) => [t.invoice_id, num(t.total)]));
  const projectDocs: ProjectDoc[] = [
    ...(projectQuotes ?? []).map((q) => ({
      id: q.id, kind: "quotation" as const, number: q.number, issue_date: q.issue_date,
      status: q.status, title: q.title, total: qTotal.get(q.id) ?? 0, parent: null,
    })),
    ...(projectInvoices ?? []).map((i) => ({
      id: i.id, kind: "invoice" as const, number: i.number, issue_date: i.issue_date,
      status: i.status, title: i.title, total: iTotal.get(i.id) ?? 0, parent: i.quotation_id,
    })),
  ];

  const paidAt = Object.fromEntries(
    (investorBalances ?? []).map((b) => [b.investor_id as string, (b.paid_at as string | null) ?? null]),
  );

  const investmentRows: InvestmentRow[] = (financingSources ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    source_type: s.source_type as InvestmentRow["source_type"],
    investor_id: (s.investor_id as string | null) ?? null,
    amount: num(s.amount),
    funded_on: s.funded_on ?? null,
  }));
  // what the capital pool holds, less what is already reinvested elsewhere
  const availableCapital =
    Math.round((num(poolSummary?.pool_total) - num(poolSummary?.pool_deployed)) * 100) / 100;

  // sign the stored bill photos so they can be shown without making the
  // bucket public
  const paths = (bills ?? []).map((b) => b.attachment_path).filter(Boolean) as string[];
  const signed = paths.length
    ? (await supabase.storage.from("bills").createSignedUrls(paths, 60 * 60)).data ?? []
    : [];
  const urlByPath = new Map(
    signed.filter((s) => s.signedUrl).map((s) => [s.path as string, s.signedUrl]),
  );

  const billRows = (bills ?? []).map((b) => ({
    id: b.id,
    bill_no: b.bill_no,
    shop: (b.vendors as unknown as { name: string } | null)?.name ?? b.description ?? null,
    vendor_id: b.vendor_id ?? null,
    supplier_tin: (b.vendors as unknown as { tin: string | null } | null)?.tin ?? null,
    description: b.description,
    category_id: b.category_id ?? "",
    category: (b.cost_categories as unknown as { name: string } | null)?.name ?? null,
    issue_date: b.issue_date,
    subtotal: num(b.subtotal),
    tax_amount: num(b.tax_amount),
    total: num(b.total),
    gst_rate: num(b.gst_rate),
    taxable_activity_no: b.taxable_activity_no,
    expense_class: b.expense_class ?? "revenue",
    photo_url: b.attachment_path ? urlByPath.get(b.attachment_path) ?? null : null,
  }));

  const variationRows = (variations ?? []).map((v) => ({
    id: v.id,
    ref: v.ref,
    description: v.description,
    cost_impact: num(v.cost_impact),
    time_impact_days: num(v.time_impact_days),
    raised_date: v.raised_date,
  }));

  const dispByShare = new Map<string, "withdraw" | "retain">();
  for (const d of dispositions ?? []) {
    dispByShare.set(d.share_name as string, (d.disposition as "withdraw" | "retain") ?? "withdraw");
  }
  const completed = Boolean(project.completed_at);
  // finished and paid for: the profit is shared out and the pool credited, so
  // nothing about the project may change underneath those figures
  const locked = completed && Boolean(project.payment_received_at);
  const shares: ShareLine[] = (splits ?? []).map((s) => ({
    share_name: s.share_name,
    share_kind: s.share_kind,
    pct: num(s.pct),
    share_amount: num(s.share_amount),
    parent_share: (s.parent_share as string | null) ?? null,
    disposition: completed ? dispByShare.get(s.share_name) ?? "withdraw" : null,
  }));

  // budget vs actual, by cost category
  const byCat = new Map<string, { budget: number; actual: number }>();
  for (const b of budget ?? []) {
    const cat = (b.cost_categories as unknown as { name: string } | null)?.name ?? "Uncategorised";
    const row = byCat.get(cat) ?? { budget: 0, actual: 0 };
    row.budget += num(b.budget_amount);
    byCat.set(cat, row);
  }
  for (const b of bills ?? []) {
    if (["void", "draft"].includes(b.status)) continue;
    const cat = (b.cost_categories as unknown as { name: string } | null)?.name ?? "Uncategorised";
    const row = byCat.get(cat) ?? { budget: 0, actual: 0 };
    row.actual += num(b.total);
    byCat.set(cat, row);
  }
  const costRows = [...byCat.entries()].sort((a, b) => b[1].actual - a[1].actual);

  const client = project?.clients as unknown as { name: string } | null;
  const revised = num(p.value) + num(p.variation);
  const initialView: ProjectView =
    (await cookies()).get(VIEW_COOKIE)?.value === "boxes" ? "boxes" : "classic";

  return (
    <div>
      <div className="mb-2">
        <Link href="/projects" className="text-xs text-[var(--muted)] hover:underline">
          ← Projects
        </Link>
      </div>
      <PageHeader
        title={p.project_name}
        subtitle={`${p.code}${client?.name ? ` · ${client.name}` : ""}`}
        action={
          <div className="flex items-center gap-3">
            {project.archived_at && <Badge value="archived" />}
            <Badge value={p.status} />
            {!locked && (
              <Link
                href={`/projects/${id}/edit`}
                className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3.5 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)]"
              >
                Edit project
              </Link>
            )}
            <ArchiveButton id={id} archived={Boolean(project.archived_at)} />
          </div>
        }
      />

      <StatusBar
        projectId={id}
        completedAt={project.completed_at ?? null}
        paymentReceivedAt={project.payment_received_at ?? null}
        paymentAmount={project.payment_received_amount ?? null}
        expected={num(p.value) + num(p.variation)}
      />

      {locked && (
        <p className="mb-6 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--hover)] px-4 py-3 text-sm">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.6" aria-hidden="true" className="shrink-0 text-[var(--muted)]">
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
          </svg>
          <span>
            <span className="font-medium">Locked.</span>{" "}
            <span className="text-[var(--muted)]">
              This project is completed and paid — its profit has been shared out, so bills,
              variations and investments can no longer be changed. Undo the payment above to reopen it.
            </span>
          </span>
        </p>
      )}

      <div className={`grid gap-4 sm:grid-cols-2 ${
        company?.gst_registered ? "xl:grid-cols-5" : "xl:grid-cols-4"
      }`}>
        <Stat label="Project value" value={money(p.value)} />
        <Stat
          label="Variation"
          value={num(p.variation) ? money(p.variation) : "—"}
          hint={`Revised ${money(revised)}`}
        />
        {/* nothing is collected for MIRA until the company is registered */}
        {company?.gst_registered && (
          <Stat label="GST" value={money(p.gst)} hint="Collected for MIRA" />
        )}
        <Stat label="EXP" value={money(p.exp)} tone="bad" hint={`${bills?.length ?? 0} bills`} />
        <Stat
          label="Profit"
          value={money(p.profit)}
          tone={num(p.profit) >= 0 ? "good" : "bad"}
          hint={revised > 0 ? pct((num(p.profit) / revised) * 100, 1) : undefined}
        />
      </div>

      <ProjectViews
        initialView={initialView}
        sections={{
          cost: {
            title: "Cost breakdown",
            summary: money(p.exp),
            node: (
        <Card>
          <CardHeader title="Cost breakdown" subtitle="Budget against actual, by category" />
          {costRows.length === 0 ? (
            <Empty message="No costs recorded." />
          ) : (
            <Table>
              <thead>
                <tr><Th>Category</Th><Th right>Budget</Th><Th right>Actual</Th><Th right>Variance</Th></tr>
              </thead>
              <tbody>
                {costRows.map(([cat, r]) => {
                  const v = r.budget - r.actual;
                  return (
                    <tr key={cat}>
                      <Td>{cat}</Td>
                      <Td right>{r.budget ? money(r.budget) : "—"}</Td>
                      <Td right>{money(r.actual)}</Td>
                      <Td right className={r.budget ? (v >= 0 ? "text-emerald-700" : "text-red-700") : "text-[var(--muted)]"}>
                        {r.budget ? money(v) : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        ),
          },
          profit: {
            title: "Profit share",
            summary: money(p.profit),
            node: (
        <ProfitShareCard projectId={id} shares={shares} completed={completed} locked={locked} />
        ),
          },
          investments: {
            title: "Investments",
            summary: investmentRows.length
              ? `${money(investmentRows.reduce((s, r) => s + r.amount, 0))} · ${investmentRows.length}`
              : "None yet",
            node: (
          <InvestmentsPanel
            locked={locked}
            paidAt={paidAt}
            projectId={id}
            rows={investmentRows}
            directory={directory ?? []}
            availableCapital={availableCapital}
          />
        ),
          },
          bills: {
            title: "Bills",
            summary: `${billRows.length} bill${billRows.length === 1 ? "" : "s"}`,
            node: (
          <BillsPanel
            locked={locked}
            projectId={id}
            rows={billRows}
            categories={categories ?? []}
            defaultActivityNo={
              // the company's own number, falling back to whatever the last
              // bill was filed under until it has been set
              company?.taxable_activity_no ??
              billRows.find((b) => b.taxable_activity_no)?.taxable_activity_no ??
              null
            }
            autoReadOn={extractionAvailable()}
            gstRegistered={company?.gst_registered ?? false}
          />
        ),
          },
          variations: {
            title: "Variations",
            summary: variationRows.length
              ? `${money(num(p.variation))} · ${variationRows.length}`
              : "None",
            node: (
          <VariationsPanel projectId={id} rows={variationRows} locked={locked} />
        ),
          },
          quotations: {
            title: "Quotations",
            summary: projectQuotes?.length
              ? `${projectQuotes.length} · ${projectQuotes.some((q) => q.status === "won") ? "won" : projectQuotes[0].status}`
              : "None yet",
            node: <QuotationsPanel projectId={id} docs={projectDocs} />,
          },
        }}
      />
    </div>
  );
}
