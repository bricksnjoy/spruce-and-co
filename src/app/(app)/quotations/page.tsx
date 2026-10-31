import Link from "next/link";
import { Pending } from "@/components/pending";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Stat, Table, Th, Td, Empty } from "@/components/ui";
import { QUOTE_STATUSES, QUOTE_STATUS_LABEL, STATUS_TONE, type QuoteStatus } from "@/lib/documents";
import { money, date, num } from "@/lib/format";
import { invoicedOf, quotationInvoices } from "@/server/quotation-invoices";

export const dynamic = "force-dynamic";

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: filter } = await searchParams;
  const supabase = await createClient();
  const [{ data: quotes }, { data: totals }] = await Promise.all([
    supabase
      .from("quotations")
      .select("id, number, issue_date, valid_until, to_name, title, status, projects(id, code, name)")
      .order("seq", { ascending: false }),
    supabase.from("quotation_totals").select("*"),
  ]);
  const totalOf = new Map((totals ?? []).map((t) => [t.quotation_id, t]));
  const billed = await quotationInvoices(supabase, (quotes ?? []).filter((q) => q.status === "won").map((q) => q.number));
  const rows = (quotes ?? []).map((q) => {
    const t = totalOf.get(q.id);
    return {
      ...q,
      project: q.projects as unknown as { id: string; code: string; name: string } | null,
      total: num(t?.total),
      subtotal: num(t?.subtotal),
      invoiced: invoicedOf(billed.get(q.number)),
    };
  });

  const sum = (s: QuoteStatus[]) => rows.filter((r) => s.includes(r.status as QuoteStatus)).reduce((a, r) => a + r.total, 0);
  const decided = rows.filter((r) => r.status === "won" || r.status === "lost").length;
  const won = rows.filter((r) => r.status === "won").length;
  const shown = QUOTE_STATUSES.includes(filter as QuoteStatus) ? rows.filter((r) => r.status === filter) : rows;

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Price the work, win it, then invoice it"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/quotations/signatures"
              className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--hover)]">
              Signatures &amp; stamp
              <Pending />
            </Link>
            <Link href="/quotations/templates"
              className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--hover)]">
              Edit templates
              <Pending />
            </Link>
            <Link href="/quotations/new"
              className="rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--brand-hover)]">
              + New quotation
              <Pending light />
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open" value={money(sum(["draft", "sent"]))} hint="Drafts and quotes out with clients" />
        <Stat label="Won" value={money(sum(["won"]))} tone="good" />
        <Stat label="Win rate" value={decided ? `${Math.round((won / decided) * 100)}%` : "—"}
          hint={decided ? `${won} of ${decided} decided` : "None decided yet"} />
        <Stat label="Still to invoice"
          value={money(rows.filter((r) => r.status === "won").reduce((a, r) => a + Math.max(r.subtotal - r.invoiced, 0), 0))}
          hint="On won quotations" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", ...QUOTE_STATUSES] as const).map((s) => {
          const active = (filter ?? "all") === s || (s === "all" && !QUOTE_STATUSES.includes(filter as QuoteStatus));
          return (
            <Link key={s} href={s === "all" ? "/quotations" : `/quotations?status=${s}`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"
              }`}>
              {s === "all" ? "All" : QUOTE_STATUS_LABEL[s]}
              <span className="ml-1 opacity-70">
                {s === "all" ? rows.length : rows.filter((r) => r.status === s).length}
              </span>
            </Link>
          );
        })}
      </div>

      <Card>
        {shown.length === 0 ? (
          <Empty message={rows.length ? "No quotations with that status." : "No quotations yet — create the first one."} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Quote#</Th><Th>Date</Th><Th>To</Th><Th>Project</Th>
                <Th right>Total</Th><Th right>Invoiced</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="row-link hover:bg-[var(--hover)]">
                  <Td className="font-medium">
                    <Link href={`/quotations/${r.id}`} className="row-link-main hover:text-[var(--brand)] hover:underline">{r.number}</Link>
                  </Td>
                  <Td className="text-xs text-[var(--muted)]">{date(r.issue_date)}</Td>
                  <Td>
                    {r.to_name}
                    {r.title && <span className="block text-xs text-[var(--muted)]">{r.title}</span>}
                  </Td>
                  <Td className="text-xs">
                    {r.project ? (
                      <Link href={`/projects/${r.project.id}`} className="hover:text-[var(--brand)] hover:underline">
                        {r.project.code}
                      </Link>
                    ) : (
                      <span className="text-[var(--muted)]">—</span>
                    )}
                  </Td>
                  <Td right className="font-medium">{money(r.total)}</Td>
                  <Td right className="text-xs text-[var(--muted)]">
                    {r.invoiced ? `${Math.round((r.invoiced / (r.subtotal || 1)) * 100)}%` : "—"}
                  </Td>
                  <Td>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status]}`}>
                      {QUOTE_STATUS_LABEL[r.status as QuoteStatus]}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
