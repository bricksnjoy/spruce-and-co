import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { getSession } from "@/server/session";
import { date, money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { COMPONENT_LABEL } from "@/lib/partners";

export const dynamic = "force-dynamic";
const m = (v: number | string | bigint | null | undefined) => money(laariToNumber(typeof v === "bigint" ? v : dbToLaari(v ?? 0)));
const REASON: Record<string, string> = { completion: "On completion", bad_debt: "Bad debt adjustment", late_entry: "Late entry adjustment", manual: "Adjustment" };

/** Distribution history (§11): every split posted, and every adjustment after it, never edited. */
export default async function DistributionsPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data }, { data: contacts }] = await Promise.all([
    s.supabase.from("distributions")
      .select("id, created_at, reason, profit_amount, project_id, projects(code, name), profit_schemes(name), transactions!distributions_journal_transaction_id_fkey(date, number), distribution_lines(contact_id, component, amount)")
      .order("created_at", { ascending: false }),
    s.supabase.from("contacts").select("id, name"),
  ]);
  const names = new Map((contacts ?? []).map((c) => [c.id, c.name]));
  type D = { id: string; created_at: string; reason: string; profit_amount: string; project_id: string;
    projects: { code: string; name: string } | null; profit_schemes: { name: string } | null;
    transactions: { date: string; number: string } | null; distribution_lines: { contact_id: string; component: string; amount: string }[] };
  const rows = (data ?? []) as unknown as D[];

  return (
    <div className="max-w-6xl space-y-5">
      <div><Link href="/partners" className="text-xs text-[var(--muted)] hover:underline">← Partners & financing</Link></div>
      <PageHeader title="Distribution history" subtitle="Each profit split and each later adjustment, as posted" />
      {rows.length === 0 ? <Card><Empty message="No project has been completed and split yet." /></Card> : rows.map((d) => {
        const total = d.distribution_lines.reduce((t, l) => t + dbToLaari(l.amount), 0n);
        return (
          <Card key={d.id}>
            <CardHeader title={`${d.projects?.code ?? ""} ${d.projects?.name ?? ""} · ${REASON[d.reason] ?? d.reason}`}
              subtitle={`${d.transactions ? `${date(d.transactions.date)} · ${d.transactions.number} · ` : "Nothing to post · "}profit ${m(d.profit_amount)} · ${d.profit_schemes?.name ?? ""}`} />
            {d.distribution_lines.length === 0 ? <Empty message="Nothing to share (no profit)." /> : (
              <Table>
                <thead><tr><Th>Person</Th><Th>Component</Th><Th right>Amount</Th></tr></thead>
                <tbody>
                  {[...d.distribution_lines].sort((a, b) => (names.get(a.contact_id) ?? "").localeCompare(names.get(b.contact_id) ?? "") || a.component.localeCompare(b.component)).map((l, i) => (
                    <tr key={i}>
                      <Td><Link href={`/partners/${l.contact_id}`} className="text-[var(--brand)] hover:underline">{names.get(l.contact_id) ?? "—"}</Link></Td>
                      <Td>{COMPONENT_LABEL[l.component] ?? l.component}</Td>
                      <Td right className={dbToLaari(l.amount) < 0n ? "text-red-700" : ""}>{m(l.amount)}</Td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><Td>Total</Td><Td> </Td><Td right>{m(total)}</Td></tr>
                </tbody>
              </Table>
            )}
          </Card>
        );
      })}
    </div>
  );
}
