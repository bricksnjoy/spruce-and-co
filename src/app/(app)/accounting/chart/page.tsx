import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { money } from "@/lib/format";
import { bookLabel } from "@/lib/books";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { NewAccount } from "./new-account";

export const dynamic = "force-dynamic";

export type Account = {
  id: string; code: string; name: string; type: string; subtype: string | null; parent_id: string | null;
  currency: string; budget_category: string | null; is_system: boolean; active: boolean; description: string | null;
};

const GROUPS: [string, string][] = [
  ["asset", "Assets"], ["liability", "Liabilities"], ["equity", "Equity"],
  ["income", "Income"], ["cogs", "Cost of sales"], ["expense", "Expenses"],
];

export default async function ChartPage({ searchParams }: { searchParams: Promise<{ inactive?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { inactive } = await searchParams;
  const showInactive = inactive === "1";

  const [{ data: accounts }, { data: balances, error }] = await Promise.all([
    s.supabase.from("accounts").select("id, code, name, type, subtype, parent_id, currency, budget_category, is_system, active, description").order("code"),
    s.supabase.rpc("rpc_account_balances", {}),
  ]);
  const bal = new Map<string, bigint>((balances ?? []).map((b: { account_id: string; balance: number | string }) => [b.account_id, dbToLaari(b.balance)]));
  const all = (accounts ?? []) as Account[];
  const shown = all.filter((a) => showInactive || a.active);
  const children = new Map<string, Account[]>();
  for (const a of shown) if (a.parent_id) children.set(a.parent_id, [...(children.get(a.parent_id) ?? []), a]);
  // a parent's balance includes its sub-accounts
  const total = (a: Account): bigint => (bal.get(a.id) ?? 0n) + (children.get(a.id) ?? []).reduce((t, c) => t + total(c), 0n);

  const row = (a: Account, depth: number): React.ReactNode[] => [
    <tr key={a.id} className={a.active ? "" : "text-[var(--muted)]"}>
      <Td className="font-mono text-xs">{a.code}</Td>
      <Td>
        <span style={{ paddingLeft: depth * 20 }} className="inline-flex items-center gap-2">
          <Link href={`/accounting/chart/${a.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">{a.name}</Link>
          {a.currency !== "MVR" && <span className="rounded bg-[var(--hover)] px-1.5 text-[10px] font-medium">{a.currency}</span>}
          {!a.active && <span className="text-xs">(inactive)</span>}
        </span>
      </Td>
      <Td className="text-xs text-[var(--muted)]">{a.subtype === "bank" ? "Bank" : a.budget_category ? `Job cost · ${a.budget_category}` : a.is_system ? "System" : ""}</Td>
      <Td right>{money(laariToNumber(total(a)))}</Td>
    </tr>,
    ...(children.get(a.id) ?? []).flatMap((c) => row(c, depth + 1)),
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Chart of accounts"
        subtitle={`Balances in the ${bookLabel(s.book)} book, from the ledger`}
        action={
          <Link href={showInactive ? "/accounting/chart" : "/accounting/chart?inactive=1"} className="text-sm font-medium text-[var(--brand)] hover:underline">
            {showInactive ? "Hide inactive" : "Show inactive"}
          </Link>
        } />
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">Balances could not be loaded: {error.message}</p>}
      {canWrite(s.role) && <NewAccount parents={all.filter((a) => a.active && !a.parent_id).map(({ id, code, name, type }) => ({ id, code, name, type }))} />}
      {GROUPS.map(([type, label]) => {
        const top = shown.filter((a) => a.type === type && (!a.parent_id || !shown.some((p) => p.id === a.parent_id)));
        if (!top.length) return null;
        const sum = top.reduce((t, a) => t + total(a), 0n);
        return (
          <Card key={type}>
            <CardHeader title={label} action={<span className="text-sm font-semibold tabular-nums">{money(laariToNumber(sum))}</span>} />
            <Table>
              <thead><tr><Th className="w-24">Code</Th><Th>Account</Th><Th>Detail</Th><Th right>Balance</Th></tr></thead>
              <tbody>{top.flatMap((a) => row(a, 0))}</tbody>
            </Table>
          </Card>
        );
      })}
    </div>
  );
}
