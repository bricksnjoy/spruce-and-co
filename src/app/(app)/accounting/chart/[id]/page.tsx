import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { date, money, titleize } from "@/lib/format";
import { bookLabel } from "@/lib/books";
import { dbToLaari, laariToNumber, withRunning } from "@/lib/money";
import { EditAccount } from "./edit-account";

export const dynamic = "force-dynamic";

const LIMIT = 500;
type Line = {
  id: number; date: string; home_debit: number | string; home_credit: number | string; memo: string | null;
  transaction_id: string; transactions: { number: string | null; type: string; memo: string | null } | null;
  contacts: { name: string } | null; projects: { code: string } | null;
};

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data: a } = await s.supabase.from("accounts")
    .select("id, code, name, type, subtype, currency, budget_category, is_system, active, description, parent_id").eq("id", id).maybeSingle();
  if (!a) notFound();

  const [{ data: lines, count }, { data: balances }] = await Promise.all([
    s.supabase.from("journal_lines")
      .select("id, date, home_debit, home_credit, memo, transaction_id, transactions(number, type, memo), contacts(name), projects(code)", { count: "exact" })
      .eq("account_id", id).order("date").order("id").limit(LIMIT),
    s.supabase.rpc("rpc_account_balances", {}),
  ]);
  // debit-normal accounts grow with debits; the rest with credits
  const rows = withRunning((lines ?? []) as unknown as Line[], ["asset", "cogs", "expense"].includes(a.type) ? 1n : -1n);
  const running = rows.at(-1)?.running ?? 0n;
  const ledgerBalance = dbToLaari((balances ?? []).find((b: { account_id: string }) => b.account_id === id)?.balance ?? 0);
  const truncated = (count ?? 0) > LIMIT;
  // payroll lines are hidden from people without payroll permission; the balance still counts them
  const hidden = !truncated && running !== ledgerBalance;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title={`${a.code} · ${a.name}`}
        subtitle={`${titleize(a.type === "cogs" ? "cost of sales" : a.type)}${a.is_system ? " · system account" : ""} · ${bookLabel(s.book)} book`}
        action={<Link href="/accounting/chart" className="text-sm font-medium text-[var(--brand)] hover:underline">← Chart of accounts</Link>} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Balance</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{money(laariToNumber(ledgerBalance))}</p>
        </Card>
        <Card className="px-5 py-4 sm:col-span-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">About</p>
          <p className="mt-2 text-sm">{a.description || <span className="text-[var(--muted)]">No description.</span>}</p>
          {a.subtype && <p className="mt-1 text-xs text-[var(--muted)]">Used for: {titleize(a.subtype)}{a.budget_category ? ` · counts against the ${a.budget_category} budget` : ""}</p>}
        </Card>
      </div>

      {canWrite(s.role) && <EditAccount account={a} />}

      <Card>
        <CardHeader title="Register" subtitle={truncated ? `The first ${LIMIT} of ${count} lines` : "Every line posted to this account, oldest first"} />
        {hidden && (
          <p className="mx-5 mt-4 rounded-lg border border-[var(--border)] bg-[var(--hover)] px-4 py-2.5 text-xs text-[var(--muted)]">
            Some payroll lines are not shown to you; the balance above includes them.
          </p>
        )}
        {rows.length === 0 ? <Empty message="Nothing has been posted to this account yet." /> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Document</Th><Th>Name</Th><Th>Memo</Th><Th right>Debit</Th><Th right>Credit</Th><Th right>Balance</Th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap">{date(l.date)}</Td>
                  <Td className="whitespace-nowrap">
                    <span className="text-xs text-[var(--muted)]">{titleize(l.transactions?.type)}</span>{" "}
                    <span className="font-mono text-xs">{l.transactions?.number ?? ""}</span>
                  </Td>
                  <Td>{l.contacts?.name ?? ""}{l.projects?.code ? <span className="ml-1 text-xs text-[var(--muted)]">{l.projects.code}</span> : null}</Td>
                  <Td className="text-xs text-[var(--muted)]">{l.memo ?? l.transactions?.memo ?? ""}</Td>
                  <Td right>{dbToLaari(l.home_debit) ? money(laariToNumber(dbToLaari(l.home_debit))) : ""}</Td>
                  <Td right>{dbToLaari(l.home_credit) ? money(laariToNumber(dbToLaari(l.home_credit))) : ""}</Td>
                  <Td right>{money(laariToNumber(l.running))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
