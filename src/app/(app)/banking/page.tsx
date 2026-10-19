import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { date, money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";
import { ImportForm, TransferForm } from "@/components/banking/forms";

export const dynamic = "force-dynamic";

export default async function BankingPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data: accts }, { data: bals }, { data: open }, { data: recs }] = await Promise.all([
    s.supabase.from("accounts").select("id, code, name, subtype, currency").in("subtype", ["bank", "cash", "credit_card", "undeposited"]).eq("active", true).order("code"),
    s.supabase.rpc("rpc_account_balances", {}),
    s.supabase.from("bank_statement_lines").select("account_id").eq("status", "open"),
    s.supabase.from("reconciliations").select("account_id, statement_date, status").eq("status", "completed").order("statement_date", { ascending: false }),
  ]);
  const bal = new Map(((bals ?? []) as { account_id: string; balance: number }[]).map((b) => [b.account_id, dbToLaari(b.balance)]));
  const toReview = new Map<string, number>();
  for (const l of open ?? []) toReview.set(l.account_id, (toReview.get(l.account_id) ?? 0) + 1);
  const lastRec = new Map<string, string>();
  for (const r of recs ?? []) if (!lastRec.has(r.account_id)) lastRec.set(r.account_id, r.statement_date);
  const money_accounts = (accts ?? []).filter((a) => a.subtype !== "undeposited");
  const writer = canWrite(s.role);

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader title="Banking" subtitle={`${bookLabel(s.book)} book`}
        action={<Link href="/banking/rules" className="text-sm font-medium text-[var(--brand)] hover:underline">Bank rules</Link>} />
      <Card>
        {(accts ?? []).length === 0 ? <Empty message="No bank accounts. Add one in the Chart of accounts (Asset → Bank account)." /> : (
          <Table>
            <thead><tr><Th>Account</Th><Th right>Balance in the books</Th><Th right>To review</Th><Th right>Reconciled to</Th></tr></thead>
            <tbody>
              {(accts ?? []).map((a) => (
                <tr key={a.id} className="hover:bg-[var(--hover)]">
                  <Td>
                    {a.subtype === "undeposited" ? <Link href="/sales/deposits/new" className="font-medium hover:underline">{a.name}</Link>
                      : <Link href={`/banking/${a.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">{a.name}</Link>}
                    <span className="ml-2 font-mono text-xs text-[var(--muted)]">{a.code}</span>{a.currency !== "MVR" && <span className="ml-1 text-xs">{a.currency}</span>}
                  </Td>
                  <Td right>{money(laariToNumber(bal.get(a.id) ?? 0n))}</Td>
                  <Td right>{toReview.get(a.id) ? <Link href={`/banking/${a.id}`} className="font-medium text-amber-700 hover:underline">{toReview.get(a.id)}</Link> : ""}</Td>
                  <Td right>{lastRec.get(a.id) ? date(lastRec.get(a.id)) : a.subtype === "undeposited" ? "" : <span className="text-[var(--muted)]">never</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {writer && money_accounts.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card><CardHeader title="Import a bank statement" subtitle="CSV from BML, MIB or most banks; lines already imported are skipped" /><ImportForm accounts={money_accounts} /></Card>
          <Card><CardHeader title="Transfer between accounts" /><TransferForm accounts={money_accounts} /></Card>
        </div>
      )}
    </div>
  );
}
