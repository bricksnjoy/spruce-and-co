import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, type Session } from "@/server/session";
import { date, money, titleize, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { docStatus, type DocBalance } from "@/lib/doc-status";
import type { Side } from "./sides";
import { EditContact } from "./edit-contact";
import { ReviewButtons } from "./review-buttons";
import { PrintButton } from "./print-button";

type Tab = "transactions" | "projects" | "statement" | "details";
const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v)));

export async function ContactDetail({ s, side, id, tab, from, to }: {
  s: Session; side: Side; id: string; tab: string | undefined; from?: string; to?: string;
}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: c } = await s.supabase.from("contacts").select("*").eq("id", id).maybeSingle();
  if (!c || !(c.kinds as string[]).includes(side.kind)) notFound();
  const { data: bal } = await s.supabase.from("contact_balances_v").select("*").eq("contact_id", id).maybeSingle();

  const tabs: [Tab, string][] = [["transactions", "Transactions"], ...(side.kind === "customer" ? [["projects", "Projects"] as [Tab, string]] : []), ["statement", "Statement"], ["details", "Details"]];
  const active: Tab = tabs.some(([t]) => t === tab) ? (tab as Tab) : "transactions";
  const writer = canWrite(s.role);
  const t = today();

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader title={c.name}
        subtitle={[c.contact_person, c.phone, c.email].filter(Boolean).join(" · ") || titleize(side.kind)}
        action={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {side.kind === "customer" && writer && c.active && <>
              <Link href={`/sales/new?type=invoice&customer=${id}`} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 font-medium text-white hover:bg-[var(--brand-hover)]">New invoice</Link>
              <Link href={`/sales/payments/new?customer=${id}`} className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-medium hover:bg-[var(--brand-soft)]">Receive payment</Link>
            </>}
            {side.kind === "vendor" && writer && c.active && <>
              <Link href={`/expenses/new?type=bill&vendor=${id}`} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 font-medium text-white hover:bg-[var(--brand-hover)]">New bill</Link>
              <Link href={`/expenses/pay`} className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-medium hover:bg-[var(--brand-soft)]">Pay bills</Link>
            </>}
            <Link href={side.base} className="font-medium text-[var(--brand)] hover:underline">← {side.title}</Link>
          </div>
        } />

      {(c.needs_review || !c.active) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{!c.active ? "Archived: hidden from lists and pickers." : "Copied from the old lists and not yet confirmed as real. Check the details, then confirm or archive it."}</span>
          {writer && <ReviewButtons id={id} archived={!c.active} />}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{side.owedLabel}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{m(bal?.[side.owedKey])}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Overdue</p>
          <p className={`mt-2 text-2xl font-semibold tabular-nums ${dbToLaari(bal?.[side.overdueKey]) > 0n ? "text-red-700" : ""}`}>{m(bal?.[side.overdueKey])}</p>
        </Card>
        <Card className="px-5 py-4 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Tax</p>
          <p className="mt-2">TIN <span className="font-mono">{c.tin ?? "—"}</span></p>
          <p className="text-xs text-[var(--muted)]">{c.gst_registered ? "GST registered" : "Not GST registered"}{c.terms_days != null ? ` · ${c.terms_days}-day terms` : ""}</p>
        </Card>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] print:hidden">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`${side.base}/${id}?tab=${k}`}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${active === k ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>{l}</Link>
        ))}
      </div>

      {active === "transactions" && <Transactions s={s} id={id} today={t} />}
      {active === "projects" && <Projects s={s} id={id} />}
      {active === "statement" && <Statement s={s} side={side} c={c} from={from} to={to} />}
      {active === "details" && (
        writer ? <EditContact contact={c} base={side.base} />
          : <Card className="px-5 py-5 text-sm text-[var(--muted)]">You can view but not change contacts.</Card>
      )}
    </div>
  );
}

async function Transactions({ s, id, today }: { s: Session; id: string; today: string }) {
  const { data } = await s.supabase.from("document_balances_v")
    .select("id, type, number, date, due_date, total, applied, balance, is_draft, sent_at, voided_at")
    .eq("contact_id", id).order("date", { ascending: false }).limit(300);
  const rows = (data ?? []) as (DocBalance & { id: string; number: string | null; date: string })[];
  return (
    <Card>
      {rows.length === 0 ? <Empty message="No documents yet." /> : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Type</Th><Th>No.</Th><Th>Due</Th><Th right>Total</Th><Th right>Balance</Th><Th right>Status</Th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const st = docStatus(r, today);
              const settles = r.type === "invoice" || r.type === "bill";
              return (
                <tr key={r.id} className={st === "void" ? "text-[var(--muted)] line-through" : ""}>
                  <Td className="whitespace-nowrap">{date(r.date)}</Td>
                  <Td>{titleize(r.type)}</Td>
                  <Td className="font-mono text-xs">{r.number ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{settles && r.due_date ? date(r.due_date) : ""}</Td>
                  <Td right>{m(r.total)}</Td>
                  <Td right>{settles ? m(r.balance) : ""}</Td>
                  <Td right><Badge value={st} /></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function Projects({ s, id }: { s: Session; id: string }) {
  const { data } = await s.supabase.from("projects").select("id, code, name, status, contract_value").eq("customer_id", id).order("code");
  const rows = data ?? [];
  return (
    <Card>
      {rows.length === 0 ? <Empty message="No projects for this customer yet." /> : (
        <Table>
          <thead><tr><Th>Code</Th><Th>Project</Th><Th>Status</Th><Th right>Contract value</Th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono text-xs">{p.code}</Td>
                <Td><Link href={`/projects/${p.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">{p.name}</Link></Td>
                <Td><Badge value={p.status} /></Td>
                <Td right>{m(p.contract_value)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

type StmtRow = { line_date: string; transaction_id: string | null; type: string | null; number: string | null; memo: string | null; due_date: string | null; amount: number | null; balance: number };

async function Statement({ s, side, c, from, to }: { s: Session; side: Side; c: { id: string; name: string; address: string | null }; from?: string; to?: string }) {
  const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const end = isDate(to) ? to! : today();
  const start = isDate(from) ? from! : `${end.slice(0, 4)}-01-01`;
  const [{ data, error }, { data: company }] = await Promise.all([
    s.supabase.rpc("contact_statement", { p_contact: c.id, p_side: side.kind, p_from: start, p_to: end }),
    s.supabase.from("company").select("legal_name, trade_name, address, tin").eq("id", true).maybeSingle(),
  ]);
  const rows = (data ?? []) as StmtRow[];
  const closing = rows.at(-1)?.balance ?? 0;

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3 print:hidden" action={`${side.base}/${c.id}`}>
        <input type="hidden" name="tab" value="statement" />
        <div><label htmlFor="st-from" className="mb-1 block text-xs font-medium">From</label>
          <input id="st-from" name="from" type="date" defaultValue={start} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" /></div>
        <div><label htmlFor="st-to" className="mb-1 block text-xs font-medium">To</label>
          <input id="st-to" name="to" type="date" defaultValue={end} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" /></div>
        <button type="submit" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--brand-soft)]">Show</button>
        {side.kind === "customer"
          ? <Link href={`/print/statement/${c.id}?from=${start}&to=${end}`} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--brand-soft)]">Print / PDF</Link>
          : <PrintButton />}
      </form>
      <Card>
        <CardHeader title={`Statement · ${c.name}`}
          subtitle={`${company?.trade_name || company?.legal_name || ""} · ${date(start)} to ${date(end)}`} />
        {error ? <p className="px-5 py-4 text-sm text-red-700">{error.message}</p> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Document</Th><Th>Due</Th><Th right>Amount</Th><Th right>Balance</Th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.transaction_id ?? "bf"}-${i}`}>
                  <Td className="whitespace-nowrap">{date(r.line_date)}</Td>
                  <Td>{r.type ? <>{titleize(r.type)} <span className="font-mono text-xs">{r.number ?? ""}</span></> : <span className="text-[var(--muted)]">{r.memo}</span>}</Td>
                  <Td className="whitespace-nowrap">{r.type === "invoice" || r.type === "bill" ? date(r.due_date) : ""}</Td>
                  <Td right>{r.amount === null ? "" : m(r.amount)}</Td>
                  <Td right>{m(r.balance)}</Td>
                </tr>
              ))}
              <tr>
                <Td colSpan={4} className="text-right font-semibold">{side.kind === "customer" ? "Amount due" : "We owe"}</Td>
                <Td right className="font-semibold">{m(closing)}</Td>
              </tr>
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
