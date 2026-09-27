import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Stat, Table, Th, Td, Empty } from "@/components/ui";
import { INVOICE_STATUSES, INVOICE_STATUS_LABEL, STATUS_TONE, type InvoiceStatus } from "@/lib/documents";
import { money, date, num, today } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: filter } = await searchParams;
  const supabase = await createClient();
  const [{ data: invoices }, { data: totals }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, number, issue_date, due_date, to_name, title, status, portion_pct, quotations(id, number), projects(id, code)")
      .order("seq", { ascending: false }),
    supabase.from("invoice_totals").select("*"),
  ]);
  const totalOf = new Map((totals ?? []).map((t) => [t.invoice_id, num(t.total)]));
  const todayIso = today();
  const rows = (invoices ?? []).map((i) => ({
    ...i,
    total: totalOf.get(i.id) ?? 0,
    quotation: i.quotations as unknown as { id: string; number: string } | null,
    project: i.projects as unknown as { id: string; code: string } | null,
    overdue: i.status === "sent" && i.due_date !== null && i.due_date < todayIso,
  }));
  const sum = (s: InvoiceStatus[]) => rows.filter((r) => s.includes(r.status as InvoiceStatus)).reduce((a, r) => a + r.total, 0);
  const shown = INVOICE_STATUSES.includes(filter as InvoiceStatus) ? rows.filter((r) => r.status === filter) : rows;

  return (
    <div>
      <PageHeader title="Invoices" subtitle="Raised from won quotations — open a quotation and convert it" />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Awaiting payment" value={money(sum(["sent"]))} tone="warn" />
        <Stat label="Overdue" value={money(rows.filter((r) => r.overdue).reduce((a, r) => a + r.total, 0))}
          tone={rows.some((r) => r.overdue) ? "bad" : "default"} />
        <Stat label="Paid" value={money(sum(["paid"]))} tone="good" />
        <Stat label="Drafts" value={money(sum(["draft"]))} hint="Not sent yet" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", ...INVOICE_STATUSES] as const).map((s) => {
          const active = s === "all" ? !INVOICE_STATUSES.includes(filter as InvoiceStatus) : filter === s;
          return (
            <Link key={s} href={s === "all" ? "/invoices" : `/invoices?status=${s}`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"
              }`}>
              {s === "all" ? "All" : INVOICE_STATUS_LABEL[s]}
            </Link>
          );
        })}
      </div>

      <Card>
        {shown.length === 0 ? (
          <Empty message={rows.length ? "No invoices with that status." : "No invoices yet. Win a quotation and convert it."} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Invoice#</Th><Th>Date</Th><Th>To</Th><Th>Quote#</Th><Th right>Part</Th>
                <Th right>Total</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--hover)]">
                  <Td className="font-medium">
                    <Link href={`/invoices/${r.id}`} className="hover:text-[var(--brand)] hover:underline">{r.number}</Link>
                  </Td>
                  <Td className="text-xs text-[var(--muted)]">
                    {date(r.issue_date)}
                    {r.due_date && <span className={`block ${r.overdue ? "text-red-700" : ""}`}>due {date(r.due_date)}</span>}
                  </Td>
                  <Td>
                    {r.to_name}
                    {r.title && <span className="block text-xs text-[var(--muted)]">{r.title}</span>}
                  </Td>
                  <Td className="text-xs">
                    {r.quotation ? (
                      <Link href={`/quotations/${r.quotation.id}`} className="hover:text-[var(--brand)] hover:underline">
                        {r.quotation.number}
                      </Link>
                    ) : "—"}
                  </Td>
                  <Td right className="text-xs text-[var(--muted)]">{Number(num(r.portion_pct).toFixed(2))}%</Td>
                  <Td right className="font-medium">{money(r.total)}</Td>
                  <Td>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.overdue ? "lost" : r.status]}`}>
                      {r.overdue ? "Overdue" : INVOICE_STATUS_LABEL[r.status as InvoiceStatus]}
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
