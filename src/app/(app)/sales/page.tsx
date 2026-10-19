import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { addDays, date, money, titleize, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";

export const dynamic = "force-dynamic";

type Row = { id: string; type: string; number: string | null; date: string; due_date: string | null; total: number; balance: number;
  customer_name: string | null; project_code: string | null; status: string; voided_at: string | null };
const m = (v: number | string | bigint | null | undefined) => money(typeof v === "bigint" ? laariToNumber(v) : laariToNumber(dbToLaari(v)));

const FILTERS: [string, string][] = [["all", "All"], ["invoice", "Invoices"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["customer_payment", "Payments"],
  ["credit_note", "Credit notes"], ["sales_receipt", "Sales receipts"], ["customer_advance", "Advances"], ["deposit", "Deposits"]];

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const show = (await searchParams).show ?? "all";
  const t = today();
  const since = addDays(t, -30);

  const [{ data }, { data: paid }, { data: und }] = await Promise.all([
    s.supabase.from("sales_list_v").select("id, type, number, date, due_date, total, balance, customer_name, project_code, status, voided_at")
      .order("date", { ascending: false }).order("number", { ascending: false }).limit(500),
    s.supabase.rpc("sales_paid_since", { p_since: since }),
    s.supabase.from("accounts").select("id").eq("subtype", "undeposited").maybeSingle(),
  ]);
  const rows = (data ?? []) as Row[];
  const open = rows.filter((r) => r.type === "invoice" && ["open", "sent", "partial", "overdue"].includes(r.status));
  const unpaid = open.reduce((a, r) => a + dbToLaari(r.balance), 0n);
  const overdue = open.filter((r) => r.status === "overdue").reduce((a, r) => a + dbToLaari(r.balance), 0n);
  const { data: undLines } = und ? await s.supabase.rpc("rpc_account_balances", {}) : { data: [] };
  const undeposited = dbToLaari(((undLines ?? []) as { account_id: string; balance: number }[]).find((b) => b.account_id === und?.id)?.balance);

  const shown = rows.filter((r) => show === "all" ? true : show === "unpaid" ? open.includes(r) : show === "overdue" ? r.status === "overdue" : r.type === show);
  const writer = canWrite(s.role);

  return (
    <div className="max-w-7xl space-y-5">
      <PageHeader title="Sales" subtitle={`${bookLabel(s.book)} book`}
        action={writer ? (
          <div className="flex flex-wrap gap-2 text-sm">
            {[["/sales/new?type=invoice", "Invoice"], ["/sales/payments/new", "Receive payment"], ["/sales/new?type=sales_receipt", "Sales receipt"],
              ["/sales/new?type=credit_note", "Credit note"], ["/sales/advances", "Advance"], ["/sales/deposits/new", "Bank deposit"]].map(([h, l], i) => (
              <Link key={h} href={h} className={i === 0 ? "rounded-lg bg-[var(--brand)] px-3.5 py-2 font-medium text-white hover:bg-[var(--brand-hover)]" : "rounded-lg border border-[var(--border)] px-3 py-2 font-medium hover:bg-[var(--brand-soft)]"}>+ {l}</Link>
            ))}
          </div>
        ) : undefined} />

      {/* the money bar */}
      <div className="grid overflow-hidden rounded-xl border border-[var(--border)] sm:grid-cols-4">
        {[
          ["Unpaid", unpaid, "unpaid", "bg-blue-50"], ["Overdue", overdue, "overdue", "bg-red-50"],
          ["Paid, last 30 days", dbToLaari(paid as number | null), "customer_payment", "bg-emerald-50"], ["Not yet banked", undeposited, "deposit", "bg-amber-50"],
        ].map(([l, v, f, tone]) => (
          <Link key={l as string} href={f === "deposit" ? "/sales/deposits/new" : `/sales?show=${f}`} className={`px-5 py-4 ${tone} hover:brightness-95`}>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{l as string}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{m(v as bigint)}</p>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map(([k, l]) => (
          <Link key={k} href={`/sales?show=${k}`} className={`rounded-full px-3 py-1 text-xs font-medium ${show === k ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}>{l}</Link>
        ))}
        {s.book === "live" && <Link href="/quotations" className="ml-auto text-xs text-[var(--muted)] hover:underline">Estimates (quotations) →</Link>}
      </div>

      <Card>
        {shown.length === 0 ? <Empty message="Nothing here yet." /> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Type</Th><Th>No.</Th><Th>Customer</Th><Th>Due</Th><Th right>Total</Th><Th right>Balance</Th><Th right>Status</Th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`hover:bg-[var(--hover)] ${r.voided_at ? "text-[var(--muted)]" : ""}`}>
                  <Td className="whitespace-nowrap">{date(r.date)}</Td>
                  <Td>{titleize(r.type)}</Td>
                  <Td><Link href={`/sales/${r.id}`} className="font-mono text-xs font-medium hover:text-[var(--brand)] hover:underline">{r.number ?? "view"}</Link></Td>
                  <Td>{r.customer_name ?? "—"}{r.project_code && <span className="ml-1 text-xs text-[var(--muted)]">{r.project_code}</span>}</Td>
                  <Td className={`whitespace-nowrap ${r.status === "overdue" ? "text-red-700" : ""}`}>{r.type === "invoice" && r.due_date ? date(r.due_date) : ""}</Td>
                  <Td right>{m(r.total)}</Td>
                  <Td right>{r.type === "invoice" ? m(r.balance) : ""}</Td>
                  <Td right><Badge value={r.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-[var(--muted)]">Today is {date(t)}. Statuses are worked out from the payments applied; nothing is marked paid by hand.</p>
    </div>
  );
}
