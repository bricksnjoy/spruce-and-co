import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { VoidJournal } from "@/components/accounting/journal-form";
import { canWrite, getSession } from "@/server/session";
import { date, money, titleize } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";

export const dynamic = "force-dynamic";

/** Manual journal entries and opening balances (§9 Accounting). */
export default async function JournalsPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const { data } = await s.supabase.from("transactions")
    .select("id, date, number, type, memo, voided_at, void_reason, transaction_lines(debit)").in("type", ["journal", "opening_balance"])
    .order("date", { ascending: false }).limit(300);
  const rows = (data ?? []) as unknown as { id: string; date: string; number: string | null; type: string; memo: string | null; voided_at: string | null; void_reason: string | null; transaction_lines: { debit: number }[] }[];
  const writer = canWrite(s.role);
  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader title="Journal entries" subtitle={`Manual entries and opening balances · ${bookLabel(s.book)} book`}
        action={writer ? <div className="flex gap-2 text-sm">
          <Link href="/accounting/journal/new?type=opening_balance" className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-medium hover:bg-[var(--brand-soft)]">Opening balances</Link>
          <Link href="/accounting/journal/new" className="rounded-lg bg-[var(--brand)] px-3 py-1.5 font-medium text-white hover:bg-[var(--brand-hover)]">New journal entry</Link>
        </div> : undefined} />
      <Card>
        {rows.length === 0 ? <Empty message="No journal entries yet." /> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>No.</Th><Th>Kind</Th><Th>Memo</Th><Th right>Debits</Th><Th right> </Th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.voided_at ? "text-[var(--muted)]" : ""}>
                  <Td className="whitespace-nowrap">{date(t.date)}</Td>
                  <Td><Link href={`/reports/journal?txn=${t.id}`} className="font-mono text-xs text-[var(--brand)] hover:underline">{t.number ?? "—"}</Link></Td>
                  <Td>{titleize(t.type)}</Td>
                  <Td>{t.memo ?? ""}{t.voided_at && <span className="block text-xs">Void: {t.void_reason}</span>}</Td>
                  <Td right>{money(laariToNumber(t.transaction_lines.reduce((x, l) => x + dbToLaari(l.debit), 0n)))}</Td>
                  <Td right>{t.voided_at ? <Badge value="void" /> : writer && <VoidJournal id={t.id} />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
