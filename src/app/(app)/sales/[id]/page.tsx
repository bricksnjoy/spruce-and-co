import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { date, dateTime, money, titleize } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { DocActions } from "@/components/sales/doc-actions";

export const dynamic = "force-dynamic";
const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v)));
const EDITABLE = ["invoice", "credit_note", "sales_receipt"];

export default async function SalesDocPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: d } = await s.supabase.from("sales_list_v").select("*").eq("id", id).maybeSingle();
  if (!d) notFound();
  const [{ data: t }, { data: lines }, { data: appliedTo }, { data: appliedFrom }, { data: dep }] = await Promise.all([
    s.supabase.from("transactions").select("memo, reference, currency, fx_rate, void_reason, bank_account_id, accounts:bank_account_id(code, name), created_at").eq("id", id).maybeSingle(),
    s.supabase.from("transaction_lines").select("id, description, qty, rate, amount, tax_amount, tax_codes(code), projects(code), accounts(code, name)").eq("transaction_id", id).order("line_no"),
    s.supabase.from("applications").select("amount, from:from_transaction_id(id, type, number, date, voided_at)").eq("to_transaction_id", id),
    s.supabase.from("applications").select("amount, to:to_transaction_id(id, type, number, date)").eq("from_transaction_id", id),
    d.deposited_in ? s.supabase.from("transactions").select("id, number, date").eq("id", d.deposited_in).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const hasLines = EDITABLE.includes(d.type);
  const subtotal = (lines ?? []).reduce((a, l) => a + dbToLaari(l.amount), 0n);
  const gst = (lines ?? []).reduce((a, l) => a + dbToLaari(l.tax_amount), 0n);
  const bank = t?.accounts as unknown as { code: string; name: string } | null;
  type Link1 = { id: string; type: string; number: string | null; date: string; voided_at?: string | null };

  return (
    <div className="max-w-5xl space-y-5">
      <Link href="/sales" className="text-xs text-[var(--muted)] hover:underline">← Sales</Link>
      <PageHeader title={`${titleize(d.type)} ${d.number ?? ""}`}
        subtitle={`${d.customer_name ?? ""}${d.project_code ? ` · ${d.project_code}` : ""} · ${date(d.date)}`}
        action={<div className="flex items-center gap-3"><Badge value={d.status} />
          <DocActions id={id} type={d.type} status={d.status} voided={Boolean(d.voided_at)} sent={Boolean(d.sent_at)}
            canEdit={canWrite(s.role)} editable={EDITABLE.includes(d.type)} balance={String(d.balance)} contactId={d.contact_id} /></div>} />

      {d.voided_at && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--hover)] px-4 py-2.5 text-sm">
          Void since {dateTime(d.voided_at)}{t?.void_reason ? `: ${t.void_reason}` : ""}. It stays on record with no effect on the books.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="px-5 py-4"><p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Total</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{m(d.total)}{d.currency !== "MVR" ? ` ${d.currency}` : ""}</p></Card>
        {d.type === "invoice" ? (
          <>
            <Card className="px-5 py-4"><p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Paid or credited</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{m(d.applied)}</p></Card>
            <Card className="px-5 py-4"><p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Balance due {d.due_date ? date(d.due_date) : ""}</p>
              <p className={`mt-2 text-2xl font-semibold tabular-nums ${d.status === "overdue" ? "text-red-700" : ""}`}>{m(d.balance)}</p></Card>
          </>
        ) : (
          <Card className="px-5 py-4 sm:col-span-2 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Money</p>
            <p className="mt-2">{bank ? `Paid into ${bank.code} · ${bank.name}` : ["customer_payment", "sales_receipt"].includes(d.type) ? "Held in Undeposited Funds" : "—"}
              {dep ? <> · banked in <Link href={`/sales/${dep.id}`} className="font-medium text-[var(--brand)] hover:underline">deposit {date(dep.date)}</Link></> : null}</p>
            {["customer_payment", "credit_note", "advance_application"].includes(d.type) && <p className="text-xs text-[var(--muted)]">{m(d.applied_from)} applied to invoices · {money(laariToNumber(dbToLaari(d.total) - dbToLaari(d.applied_from)))} left as credit</p>}
          </Card>
        )}
      </div>

      {hasLines && (
        <Card>
          <CardHeader title="Lines" />
          {(lines ?? []).length === 0 ? <Empty message="No lines." /> : (
            <Table>
              <thead><tr><Th>Description</Th><Th right>Qty</Th><Th right>Rate</Th><Th right>Amount</Th><Th right>GST</Th></tr></thead>
              <tbody>
                {(lines ?? []).map((l) => {
                  const tc = l.tax_codes as unknown as { code: string } | null;
                  const pj = l.projects as unknown as { code: string } | null;
                  const ac = l.accounts as unknown as { code: string; name: string } | null;
                  return (
                    <tr key={l.id}>
                      <Td>{l.description}<p className="text-xs text-[var(--muted)]">{[pj?.code, ac ? `${ac.code} ${ac.name}` : null].filter(Boolean).join(" · ")}</p></Td>
                      <Td right>{l.qty == null ? "" : Number(l.qty)}</Td>
                      <Td right>{l.rate == null ? "" : m(l.rate)}</Td>
                      <Td right>{m(l.amount)}</Td>
                      <Td right>{m(l.tax_amount)}<span className="ml-1 text-xs text-[var(--muted)]">{tc?.code ?? ""}</span></Td>
                    </tr>
                  );
                })}
                <tr><Td colSpan={3} className="text-right text-[var(--muted)]">Subtotal</Td><Td right>{money(laariToNumber(subtotal))}</Td><Td right>{money(laariToNumber(gst))}</Td></tr>
                <tr className="font-semibold"><Td colSpan={4} className="text-right">Total</Td><Td right>{money(laariToNumber(subtotal + gst))}</Td></tr>
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {(appliedTo ?? []).length > 0 && (
        <Card>
          <CardHeader title="Payments and credits applied" />
          <Table>
            <tbody>
              {(appliedTo ?? []).map((a, i) => {
                const f = a.from as unknown as Link1;
                return (
                  <tr key={i} className={f.voided_at ? "text-[var(--muted)] line-through" : ""}>
                    <Td>{date(f.date)}</Td><Td><Link href={`/sales/${f.id}`} className="hover:underline">{titleize(f.type)} {f.number ?? ""}</Link></Td><Td right>{m(a.amount)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
      {(appliedFrom ?? []).length > 0 && (
        <Card>
          <CardHeader title="Applied to" />
          <Table>
            <tbody>
              {(appliedFrom ?? []).map((a, i) => {
                const to = a.to as unknown as Link1;
                return <tr key={i}><Td>{date(to.date)}</Td><Td><Link href={`/sales/${to.id}`} className="hover:underline">{titleize(to.type)} {to.number ?? ""}</Link></Td><Td right>{m(a.amount)}</Td></tr>;
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {(t?.memo || t?.reference) && (
        <Card className="px-5 py-4 text-sm">
          {t?.reference && <p><span className="text-[var(--muted)]">Reference</span> {t.reference}</p>}
          {t?.memo && <p className="mt-1 whitespace-pre-line">{t.memo}</p>}
        </Card>
      )}
    </div>
  );
}
