import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { date, dateTime, money, titleize, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { ExpenseActions, ApplyCredit } from "@/components/expenses/expense-actions";

export const dynamic = "force-dynamic";
const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v)));
const HAS_LINES = ["bill", "expense", "vendor_credit", "purchase_order"];

export default async function ExpenseDocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ note?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ id }, { note }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: d } = await s.supabase.from("expenses_list_v").select("*").eq("id", id).maybeSingle();
  if (!d) notFound();
  const [{ data: t }, { data: lines }, { data: appliedTo }, { data: appliedFrom }, { data: files }, { data: po }] = await Promise.all([
    s.supabase.from("transactions").select("supplier_tin, tax_invoice_no, tax_invoice_date, customs_ref, void_reason, approved_at, bank_account_id, accounts:bank_account_id(code, name)").eq("id", id).maybeSingle(),
    s.supabase.from("transaction_lines").select("id, description, qty, rate, amount, tax_amount, gst_claimable, projects(code), accounts(code, name)").eq("transaction_id", id).order("line_no"),
    s.supabase.from("applications").select("amount, from:from_transaction_id(id, type, number, date, voided_at)").eq("to_transaction_id", id),
    s.supabase.from("applications").select("amount, to:to_transaction_id(id, type, number, date)").eq("from_transaction_id", id),
    s.supabase.from("attachments").select("id, storage_path, file_name").eq("transaction_id", id),
    d.purchase_order_id ? s.supabase.from("transactions").select("id, number").eq("id", d.purchase_order_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: billsFromPo } = d.type === "purchase_order" ? await s.supabase.from("transactions").select("id, number, date, is_draft").eq("purchase_order_id", id) : { data: [] };
  const photos = files?.length ? (await s.supabase.storage.from("bills").createSignedUrls(files.map((f) => f.storage_path), 3600)).data ?? [] : [];
  const openBills = d.type === "vendor_credit" && !d.voided_at
    ? ((await s.supabase.from("expenses_list_v").select("id, number, date, balance, tax_invoice_no").eq("contact_id", d.contact_id).eq("type", "bill").in("status", ["open", "partial", "overdue"])).data ?? [])
    : [];
  const subtotal = (lines ?? []).reduce((a, l) => a + dbToLaari(l.amount), 0n);
  const gst = (lines ?? []).reduce((a, l) => a + dbToLaari(l.tax_amount), 0n);
  const bank = t?.accounts as unknown as { code: string; name: string } | null;
  const writer = canWrite(s.role);
  type L = { id: string; type: string; number: string | null; date: string; voided_at?: string | null };

  return (
    <div className="max-w-5xl space-y-5">
      <Link href="/expenses" className="text-xs text-[var(--muted)] hover:underline">← Expenses</Link>
      <PageHeader title={`${titleize(d.type)} ${d.number ?? t?.tax_invoice_no ?? ""}`}
        subtitle={`${d.vendor_name ?? "No vendor"}${d.project_code ? ` · ${d.project_code}` : ""} · ${date(d.date)}`}
        action={<div className="flex items-center gap-3"><Badge value={d.status} />
          <ExpenseActions id={id} type={d.type} status={d.status} voided={Boolean(d.voided_at)} canEdit={writer} isAdmin={s.role === "admin"}
            contactId={d.contact_id} balance={String(d.balance)} poClosed={d.type === "purchase_order" && d.status === "closed"} /></div>} />

      {note && <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">{note}</p>}
      {d.status === "awaiting_approval" && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Over the bill approval limit: it posts, and can be paid, once an admin approves it.
        </p>
      )}
      {d.voided_at && <p className="rounded-lg border border-[var(--border)] bg-[var(--hover)] px-4 py-2.5 text-sm">Void since {dateTime(d.voided_at)}{t?.void_reason ? `: ${t.void_reason}` : ""}.</p>}
      {d.type === "bill" && [d.licence_expiry, d.insurance_expiry].some((x: string | null) => x && x < today()) && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">This vendor&apos;s licence or insurance has expired; check before paying.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="px-5 py-4"><p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Total</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{m(d.total)}{d.currency !== "MVR" ? ` ${d.currency}` : ""}</p></Card>
        {d.type === "bill" ? (
          <>
            <Card className="px-5 py-4"><p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Paid or credited</p><p className="mt-2 text-2xl font-semibold tabular-nums">{m(d.applied)}</p></Card>
            <Card className="px-5 py-4"><p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Balance due {d.due_date ? date(d.due_date) : ""}</p>
              <p className={`mt-2 text-2xl font-semibold tabular-nums ${d.status === "overdue" ? "text-red-700" : ""}`}>{m(d.balance)}</p></Card>
          </>
        ) : (
          <Card className="px-5 py-4 text-sm sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Details</p>
            {bank && <p className="mt-2">Paid from {bank.code} · {bank.name}</p>}
            {d.type === "vendor_credit" && <p className="mt-2">{m(d.applied_from)} applied to bills · {money(laariToNumber(dbToLaari(d.total) - dbToLaari(d.applied_from)))} left</p>}
            {d.type === "purchase_order" && <p className="mt-2">{d.status === "open" ? "Open: counts as committed cost on the project" : "Closed"}</p>}
            {po && <p className="mt-2">From purchase order <Link href={`/expenses/${po.id}`} className="font-medium text-[var(--brand)] hover:underline">{po.number}</Link></p>}
          </Card>
        )}
      </div>

      {(t?.supplier_tin || t?.tax_invoice_no || t?.customs_ref) && (
        <Card className="px-5 py-4 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Tax invoice</p>
          <p className="mt-1">{[t?.supplier_tin && `TIN ${t.supplier_tin}`, t?.tax_invoice_no && `No. ${t.tax_invoice_no}`, t?.tax_invoice_date && date(t.tax_invoice_date), t?.customs_ref && `Customs ${t.customs_ref}`].filter(Boolean).join(" · ")}</p>
        </Card>
      )}

      {HAS_LINES.includes(d.type) && (
        <Card>
          <CardHeader title="Lines" />
          {(lines ?? []).length === 0 ? <Empty message="No lines." /> : (
            <Table>
              <thead><tr><Th>For</Th><Th>Description</Th><Th right>Amount</Th><Th right>GST</Th></tr></thead>
              <tbody>
                {(lines ?? []).map((l) => {
                  const ac = l.accounts as unknown as { code: string; name: string } | null;
                  const pj = l.projects as unknown as { code: string } | null;
                  return (
                    <tr key={l.id}>
                      <Td>{ac ? `${ac.code} · ${ac.name}` : "—"}{pj && <p className="text-xs text-[var(--muted)]">{pj.code}</p>}</Td>
                      <Td>{l.description}{l.qty != null && <p className="text-xs text-[var(--muted)]">{Number(l.qty)} × {m(l.rate)}</p>}</Td>
                      <Td right>{m(l.amount)}</Td>
                      <Td right>{m(l.tax_amount)}{dbToLaari(l.tax_amount) > 0n && <p className="text-xs text-[var(--muted)]">{l.gst_claimable ? "claimed" : "part of cost"}</p>}</Td>
                    </tr>
                  );
                })}
                <tr className="font-semibold"><Td colSpan={2} className="text-right">Total</Td><Td right>{money(laariToNumber(subtotal))}</Td><Td right>{money(laariToNumber(gst))}</Td></tr>
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {(billsFromPo ?? []).length > 0 && (
        <Card><CardHeader title="Billed as" />
          <Table><tbody>{(billsFromPo ?? []).map((b) => <tr key={b.id}><Td>{date(b.date)}</Td><Td><Link href={`/expenses/${b.id}`} className="hover:underline">Bill {b.number ?? "(draft)"}</Link></Td></tr>)}</tbody></Table>
        </Card>
      )}

      {writer && openBills.length > 0 && dbToLaari(d.total) - dbToLaari(d.applied_from) > 0n && (
        <ApplyCredit creditId={id} bills={openBills.map((b) => ({ id: b.id, label: `${b.number ?? b.tax_invoice_no ?? "Bill"} · ${date(b.date)}`, balance: String(b.balance) }))} />
      )}

      {[...(appliedTo ?? []).map((a) => ({ a, l: a.from as unknown as L, dir: "from" })), ...(appliedFrom ?? []).map((a) => ({ a, l: a.to as unknown as L, dir: "to" }))].length > 0 && (
        <Card>
          <CardHeader title={d.type === "bill" ? "Payments and credits applied" : "Applied to"} />
          <Table><tbody>
            {[...(appliedTo ?? []).map((a) => ({ a, l: a.from as unknown as L })), ...(appliedFrom ?? []).map((a) => ({ a, l: a.to as unknown as L }))].map(({ a, l }, i) => (
              <tr key={i} className={l.voided_at ? "text-[var(--muted)] line-through" : ""}>
                <Td>{date(l.date)}</Td><Td><Link href={`/expenses/${l.id}`} className="hover:underline">{titleize(l.type)} {l.number ?? ""}</Link></Td><Td right>{m(a.amount)}</Td>
              </tr>
            ))}
          </tbody></Table>
        </Card>
      )}

      {photos.length > 0 && (
        <Card>
          <CardHeader title="Photos" />
          <div className="flex flex-wrap gap-3 px-5 py-4">
            {photos.map((p, i) => p.signedUrl && (
              <a key={i} href={p.signedUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.signedUrl} alt={files?.[i]?.file_name ?? "Bill photo"} className="h-40 rounded border border-[var(--border)] object-cover" />
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
