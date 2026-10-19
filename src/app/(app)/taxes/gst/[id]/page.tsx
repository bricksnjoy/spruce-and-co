import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { date, dateTime, money, titleize, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { docHref } from "@/lib/doc-href";
import { periodLabel, type ScheduleRow } from "@/lib/gst";
import { FileReturnForm, PayReturnForm } from "@/components/taxes/forms";

export const dynamic = "force-dynamic";
const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v ?? 0)));
const KIND: Record<string, string> = { standard: "Standard rated", zero: "Zero rated", exempt: "Exempt", out_of_scope: "Out of scope", none: "No tax code" };

/** One GST return (§8): the worksheet, the output and input schedules, then file, then pay. */
export default async function GstReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: p } = await s.supabase.from("gst_periods_v").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [{ data: sched }, { data: supplies }, { data: banks }, { data: earlier }] = await Promise.all([
    s.supabase.rpc("gst_schedule", { p_period: id }),
    s.supabase.rpc("gst_supplies", { p_from: p.start_date, p_to: p.end_date }),
    s.supabase.from("accounts").select("id, code, name").in("subtype", ["bank", "cash"]).eq("active", true).order("code"),
    s.supabase.from("tax_periods").select("id").eq("status", "open").lt("start_date", p.start_date).limit(1),
  ]);
  const rows = (sched ?? []) as ScheduleRow[];
  const out = rows.filter((r) => r.side === "output"), inp = rows.filter((r) => r.side === "input");
  const label = periodLabel(p.start_date, p.end_date);
  const writer = canWrite(s.role);
  const ended = p.end_date < today();
  const adjOut = dbToLaari(p.prior_output_adjustments), adjIn = dbToLaari(p.prior_input_adjustments);
  const sup = (supplies ?? []) as { side: string; kind: string; net: number; gst: number }[];

  const schedule = (list: ScheduleRow[], side: "output" | "input") => list.length === 0 ? <Empty message={side === "output" ? "No output tax in this return." : "No input tax in this return."} /> : (
    <Table>
      <thead><tr><Th>Date</Th><Th>Document</Th><Th>{side === "output" ? "Customer" : "Supplier"}</Th><Th>TIN</Th>{side === "input" && <Th>Tax invoice</Th>}<Th right>Taxable value</Th><Th right>GST</Th></tr></thead>
      <tbody>
        {list.map((r) => {
          const href = docHref(r.type, r.transaction_id);
          const name = `${titleize(r.type)} ${r.number ?? ""}`;
          return (
            <tr key={`${r.side}-${r.transaction_id}`} className={r.late || r.correction ? "bg-amber-50/60" : ""}>
              <Td className="whitespace-nowrap">{date(r.date)}</Td>
              <Td>{href ? <Link href={href} className="hover:underline">{name}</Link> : name}
                {r.correction ? <span className="ml-2 text-xs text-amber-700">correction to a filed return</span> : r.late ? <span className="ml-2 text-xs text-amber-700">from an earlier period</span> : null}</Td>
              <Td>{r.contact_name ?? ""}</Td>
              <Td className={side === "input" && !r.tin && !r.customs_ref ? "text-red-700" : "text-xs"}>{r.tin ?? (side === "input" && !r.customs_ref ? "missing" : "")}</Td>
              {side === "input" && <Td className="text-xs">{r.customs_ref ? `Customs ${r.customs_ref}` : [r.tax_invoice_no, r.tax_invoice_date && date(r.tax_invoice_date)].filter(Boolean).join(" · ")}</Td>}
              <Td right>{r.taxable === null ? "—" : m(r.taxable)}</Td>
              <Td right>{m(r.gst)}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );

  return (
    <div className="max-w-6xl space-y-5">
      <Link href="/taxes" className="text-xs text-[var(--muted)] hover:underline">← Taxes</Link>
      <PageHeader title={`GST return · ${label}`} subtitle={`${date(p.start_date)} – ${date(p.end_date)} · due ${date(p.due_date)}`} action={<Badge value={p.status} />} />
      {p.status !== "open" && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--muted)]">
          Filed {dateTime(p.filed_at)}{p.return_reference ? ` · MIRA reference ${p.return_reference}` : ""}. These are the figures as filed; later changes to its documents are in the next return.
        </p>
      )}

      <Card>
        <CardHeader title="Worksheet" />
        <div className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
          <p>Output tax <strong className="block text-lg tabular-nums">{m(p.output)}</strong>
            {adjOut !== 0n && <span className="text-xs text-amber-700">includes {money(laariToNumber(adjOut))} from earlier periods</span>}</p>
          <p>Input tax <strong className="block text-lg tabular-nums">{m(p.input)}</strong>
            {adjIn !== 0n && <span className="text-xs text-amber-700">includes {money(laariToNumber(adjIn))} from earlier periods</span>}</p>
          <p>{Number(p.net) < 0 ? "Credit (carried forward)" : "Net payable"} <strong className="block text-lg tabular-nums">{m(p.net)}</strong>
            {p.status !== "open" && <span className="text-xs text-[var(--muted)]">still owed {m(p.payable)}</span>}</p>
        </div>
        {sup.length > 0 && (
          <Table>
            <thead><tr><Th>Supplies dated in the period</Th><Th>Tax code</Th><Th right>Value</Th><Th right>GST</Th></tr></thead>
            <tbody>
              {sup.map((x) => (
                <tr key={`${x.side}-${x.kind}`}><Td>{x.side === "sales" ? "Sales" : "Purchases"}</Td><Td>{KIND[x.kind] ?? x.kind}</Td><Td right>{m(x.net)}</Td><Td right>{m(x.gst)}</Td></tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={`Output tax schedule (${out.length})`} action={<a href={`/taxes/gst/${id}/csv?side=output`} className="text-sm font-medium text-[var(--brand)] hover:underline">Download CSV</a>} />
        {schedule(out, "output")}
      </Card>
      <Card>
        <CardHeader title={`Input tax schedule (${inp.length})`} subtitle="Per supplier tax invoice, with TIN; customs declarations for imports"
          action={<a href={`/taxes/gst/${id}/csv?side=input`} className="text-sm font-medium text-[var(--brand)] hover:underline">Download CSV</a>} />
        {schedule(inp, "input")}
      </Card>

      {writer && p.status === "open" && (
        <Card>
          <CardHeader title="File this return" subtitle="After you file with MIRA, record it here" />
          {(earlier ?? []).length > 0 ? <p className="px-5 py-4 text-sm text-amber-800">An earlier return is still open. Returns are filed in order: file that one first.</p> : (
            <>
              {!ended && <p className="px-5 pt-4 text-sm text-amber-800">This period has not ended yet. Anything dated in it after filing will go into the next return.</p>}
              <FileReturnForm periodId={id} net={m(p.net)} />
            </>
          )}
        </Card>
      )}
      {writer && p.status === "filed" && dbToLaari(p.payable) > 0n && (
        <Card>
          <CardHeader title="Pay MIRA" subtitle={`${m(p.payable)} still owed on this return`} />
          <PayReturnForm periodId={id} owed={laariToNumber(dbToLaari(p.payable)).toFixed(2)} banks={banks ?? []} />
        </Card>
      )}
    </div>
  );
}
