import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Table, Th, Td } from "@/components/ui";
import { DocumentSheet } from "@/components/document-sheet";
import { loadQuotation } from "@/lib/document-loaders";
import { type QuoteStatus } from "@/lib/documents";
import { invoicedOf, quotationInvoices } from "@/server/quotation-invoices";
import { money, date, num } from "@/lib/format";
import { ConvertButton, DeleteQuotation, StatusPicker } from "./quotation-controls";

export const dynamic = "force-dynamic";

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [doc, { data: totals }] = await Promise.all([
    loadQuotation(supabase, id),
    supabase.from("quotation_totals").select("*").eq("quotation_id", id).maybeSingle(),
  ]);
  if (!doc) notFound();
  const { q, project, template, signer, sheet } = doc;

  // invoices in the books carry the quotation's number as their reference
  const invoices = (await quotationInvoices(supabase, [q.number])).get(q.number) ?? [];
  const subtotal = num(totals?.subtotal);
  const invoiced = invoicedOf(invoices);
  const live = invoices;
  const status = q.status as QuoteStatus;

  return (
    <div>
      <div className="mb-2">
        <Link href="/quotations" className="text-xs text-[var(--muted)] hover:underline">← Quotations</Link>
      </div>
      <PageHeader
        title={q.number}
        subtitle={[q.to_name, q.title].filter(Boolean).join(" · ")}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {!live.length && <DeleteQuotation id={q.id} />}
            {!live.length && (
              <Link href={`/quotations/${q.id}/edit`}
                className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--hover)]">
                Edit
              </Link>
            )}
            <Link href={`/print/quotations/${q.id}`} target="_blank"
              className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--hover)]">
              Print / PDF
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 overflow-auto rounded-xl border border-[var(--border)] bg-[#e9ecf0] p-4">
          <div style={{ zoom: 0.8 }}>
            <DocumentSheet header={template.header} body={template.body} tail={template.tail}
              signer={signer} data={sheet} />
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Status" subtitle={q.status_changed_at ? `Changed ${date(q.status_changed_at)}` : "Set as it moves along"} />
            <div className="space-y-4 px-5 py-4">
              <StatusPicker id={q.id} status={status} />
              {status === "won" ? (
                <ConvertButton quotationId={q.id} subtotal={subtotal} invoiced={invoiced} taxRate={num(q.tax_rate)} />
              ) : (
                <p className="text-xs text-[var(--muted)]">Mark it won to turn it into invoices.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Summary" />
            <dl className="space-y-2 px-5 py-4 text-sm">
              <Row k="Total">{money(num(totals?.total))}</Row>
              <Row k="Invoiced">
                {money(invoiced)}
                <span className="ml-1 text-xs text-[var(--muted)]">
                  ({subtotal ? Number(((invoiced / subtotal) * 100).toFixed(2)) : 0}%)
                </span>
              </Row>
              <Row k="Left to invoice">{money(Math.max(subtotal - invoiced, 0))}</Row>
              <Row k="Project">
                {project ? (
                  <Link href={`/projects/${project.id}`} className="hover:text-[var(--brand)] hover:underline">
                    {project.code} · {project.name}
                  </Link>
                ) : (
                  <span className="text-[var(--muted)]">Not linked</span>
                )}
              </Row>
              <Row k="Valid until">{date(q.valid_until)}</Row>
            </dl>
            {q.notes && (
              <p className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted)]">{q.notes}</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Invoices" subtitle="Raised from this quotation, in Sales & invoices" />
            {!invoices.length ? (
              <p className="px-5 py-6 text-center text-sm text-[var(--muted)]">None yet.</p>
            ) : (
              <Table>
                <thead>
                  <tr><Th>Invoice</Th><Th right>Part</Th><Th right>Total</Th></tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="hover:bg-[var(--hover)]">
                      <Td>
                        <Link href={`/sales/${i.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                          {i.number ?? "Draft"}
                        </Link>
                        {i.is_draft && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Draft</span>}
                        <span className="block text-xs text-[var(--muted)]">{date(i.date)}</span>
                      </Td>
                      <Td right className="text-[var(--muted)]">{subtotal ? Number(((i.subtotal / subtotal) * 100).toFixed(2)) : 0}%</Td>
                      <Td right>{money(i.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
