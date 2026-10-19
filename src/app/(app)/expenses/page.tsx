import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { addDays, date, money, titleize, today } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";

export const dynamic = "force-dynamic";

type Row = { id: string; type: string; number: string | null; date: string; due_date: string | null; total: number; balance: number;
  vendor_name: string | null; project_code: string | null; status: string; voided_at: string | null; tax_invoice_no: string | null };
const m = (v: number | string | bigint | null | undefined) => money(typeof v === "bigint" ? laariToNumber(v) : laariToNumber(dbToLaari(v)));
const FILTERS: [string, string][] = [["all", "All"], ["bill", "Bills"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["awaiting_approval", "Awaiting approval"],
  ["expense", "Expenses"], ["bill_payment", "Payments"], ["vendor_credit", "Vendor credits"], ["purchase_order", "Purchase orders"]];

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const show = (await searchParams).show ?? "all";
  const t = today();
  const [{ data }, { data: paid }] = await Promise.all([
    s.supabase.from("expenses_list_v").select("id, type, number, date, due_date, total, balance, vendor_name, project_code, status, voided_at, tax_invoice_no")
      .order("date", { ascending: false }).limit(500),
    s.supabase.rpc("bills_paid_since", { p_since: addDays(t, -30) }),
  ]);
  const rows = (data ?? []) as Row[];
  const open = rows.filter((r) => r.type === "bill" && ["open", "partial", "overdue", "sent"].includes(r.status));
  const unpaid = open.reduce((a, r) => a + dbToLaari(r.balance), 0n);
  const overdue = open.filter((r) => r.status === "overdue").reduce((a, r) => a + dbToLaari(r.balance), 0n);
  const pending = rows.filter((r) => r.status === "awaiting_approval");
  const shown = rows.filter((r) => show === "all" ? true : show === "unpaid" ? open.includes(r) : ["overdue", "awaiting_approval"].includes(show) ? r.status === show : r.type === show);
  const writer = canWrite(s.role);

  return (
    <div className="max-w-7xl space-y-5">
      <PageHeader title="Expenses" subtitle={`${bookLabel(s.book)} book`}
        action={writer ? (
          <div className="flex flex-wrap gap-2 text-sm">
            {[["/expenses/new?type=bill", "Bill"], ["/expenses/pay", "Pay bills"], ["/expenses/new?type=expense", "Expense"],
              ["/expenses/new?type=vendor_credit", "Vendor credit"], ["/expenses/new?type=purchase_order", "Purchase order"]].map(([h, l], i) => (
              <Link key={h} href={h} className={i === 0 ? "rounded-lg bg-[var(--brand)] px-3.5 py-2 font-medium text-white hover:bg-[var(--brand-hover)]" : "rounded-lg border border-[var(--border)] px-3 py-2 font-medium hover:bg-[var(--brand-soft)]"}>+ {l}</Link>
            ))}
          </div>
        ) : undefined} />

      <div className="grid overflow-hidden rounded-xl border border-[var(--border)] sm:grid-cols-4">
        {[["Unpaid bills", m(unpaid), "unpaid", "bg-blue-50"], ["Overdue", m(overdue), "overdue", "bg-red-50"],
          ["Paid, last 30 days", m(dbToLaari(paid as number | null)), "bill_payment", "bg-emerald-50"],
          ["Awaiting approval", String(pending.length), "awaiting_approval", "bg-amber-50"]].map(([l, v, f, tone]) => (
          <Link key={l} href={`/expenses?show=${f}`} className={`px-5 py-4 ${tone} hover:brightness-95`}>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{l}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{v}</p>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map(([k, l]) => (
          <Link key={k} href={`/expenses?show=${k}`} className={`rounded-full px-3 py-1 text-xs font-medium ${show === k ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}>{l}</Link>
        ))}
        <Link href="/expenses/vendors" className="ml-auto text-xs text-[var(--muted)] hover:underline">Vendors →</Link>
      </div>

      <Card>
        {shown.length === 0 ? <Empty message="Nothing here yet." /> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Type</Th><Th>No.</Th><Th>Vendor</Th><Th>Due</Th><Th right>Total</Th><Th right>Balance</Th><Th right>Status</Th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`hover:bg-[var(--hover)] ${r.voided_at ? "text-[var(--muted)]" : ""}`}>
                  <Td className="whitespace-nowrap">{date(r.date)}</Td>
                  <Td>{titleize(r.type)}</Td>
                  <Td><Link href={`/expenses/${r.id}`} className="font-mono text-xs font-medium hover:text-[var(--brand)] hover:underline">{r.number ?? r.tax_invoice_no ?? "view"}</Link></Td>
                  <Td>{r.vendor_name ?? "—"}{r.project_code && <span className="ml-1 text-xs text-[var(--muted)]">{r.project_code}</span>}</Td>
                  <Td className={`whitespace-nowrap ${r.status === "overdue" ? "text-red-700" : ""}`}>{r.type === "bill" && r.due_date ? date(r.due_date) : ""}</Td>
                  <Td right>{m(r.total)}</Td>
                  <Td right>{r.type === "bill" ? m(r.balance) : ""}</Td>
                  <Td right><Badge value={r.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
