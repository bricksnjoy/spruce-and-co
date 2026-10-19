import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Stat, Table, Th, Td, Empty } from "@/components/ui";
import { money, date, num } from "@/lib/format";
import { poolPosition } from "@/lib/pool";
import { PoolActions, RemoveEntry } from "./pool-actions";

export const dynamic = "force-dynamic";

const ENTRY_LABEL: Record<string, string> = {
  contribution: "Added",
  profit: "Profit earned",
  withdrawal: "Withdrawn",
  adjustment: "Adjustment",
};

export default async function CapitalPoolPage() {
  const supabase = await createClient();
  const [pos, { data: entries }, { data: deployed }] = await Promise.all([
    poolPosition(supabase),
    supabase
      .from("capital_pool_entries")
      .select("id, entry_type, amount, entry_date, origin, note, capital_pool_members(name), projects(id, name)")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("project_financing_sources")
      .select("id, amount, funded_on, projects!inner(id, name, code, payment_received_at, completed_at)")
      .eq("source_type", "capital_pool")
      .is("projects.payment_received_at", null)
      .order("funded_on", { ascending: false }),
  ]);

  const profitEarned = pos.members.reduce((s, m) => s + m.profit, 0);

  return (
    <div>
      <PageHeader
        title="Capital pool"
        subtitle="The company's and the directors' money, reinvested into projects"
        action={
          <PoolActions
            members={pos.members.map((m) => ({ id: m.id, name: m.name, balance: m.balance }))}
            available={pos.available}
          />
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pool total" value={money(pos.total)} hint="What the members own" />
        <Stat label="Reinvested" value={money(pos.deployed)} hint="In projects not yet paid for" />
        <Stat label="Available" value={money(pos.available)}
          tone={pos.available > 0 ? "good" : "default"} hint="Free for the next project" />
        <Stat label="Profit earned" value={money(profitEarned)} hint="Returned to the pool from projects" />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Members"
          subtitle="A member can take only what is free — their part of money reinvested in unpaid projects is locked until those projects are paid"
        />
        <Table>
          <thead>
            <tr>
              <Th>Member</Th><Th right>Added</Th><Th right>Profit</Th>
              <Th right>Withdrawn</Th><Th right>Balance</Th><Th right>Invested</Th>
              <Th right>Free to take</Th><Th right>Share of pool</Th>
            </tr>
          </thead>
          <tbody>
            {pos.members.map((m) => (
              <tr key={m.id} className="hover:bg-[var(--hover)]">
                <Td className="font-medium">
                  {m.name}
                  {m.kind === "company" && (
                    <span className="ml-2 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-normal text-[var(--brand)]">
                      company
                    </span>
                  )}
                </Td>
                <Td right className="text-[var(--muted)]">{m.contributed ? money(m.contributed) : "—"}</Td>
                <Td right className="text-emerald-700">{m.profit ? money(m.profit) : "—"}</Td>
                <Td right className="text-[var(--muted)]">{m.withdrawn ? `(${money(m.withdrawn)})` : "—"}</Td>
                <Td right className="font-medium">{money(m.balance)}</Td>
                <Td right className="text-[var(--muted)]">{m.invested ? money(m.invested) : "—"}</Td>
                <Td right className="font-medium text-emerald-700">{money(m.free)}</Td>
                <Td right>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--border)]">
                      <span className="block h-full rounded-full bg-[var(--brand)]"
                        style={{ width: `${Math.min(100, m.ratio)}%` }} />
                    </span>
                    <span className="w-14 text-right tabular-nums">{m.ratio.toFixed(2)}%</span>
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--hover)] font-semibold">
              <Td>Total</Td>
              <Td right>{money(pos.members.reduce((s, m) => s + m.contributed, 0))}</Td>
              <Td right>{money(profitEarned)}</Td>
              <Td right>{money(pos.members.reduce((s, m) => s + m.withdrawn, 0))}</Td>
              <Td right>{money(pos.total)}</Td>
              <Td right>{money(pos.members.reduce((s, m) => s + m.invested, 0))}</Td>
              <Td right>{money(pos.members.reduce((s, m) => s + m.free, 0))}</Td>
              <Td right>{pos.total > 0 ? "100%" : "—"}</Td>
            </tr>
          </tfoot>
        </Table>
        {pos.total === 0 && (
          <p className="border-t border-[var(--border)] px-5 py-3 text-sm text-[var(--muted)]">
            The pool is empty. Use <span className="font-medium text-[var(--text)]">+ Add money to pool</span> to
            record what each member has put in. Shares are worked out from the balances, so they move
            whenever anyone adds, earns or withdraws.
          </p>
        )}
      </Card>

      <Card className="mb-6">
        <CardHeader title="Reinvested" subtitle="Pool money in projects the client has not paid for yet" />
        {!deployed?.length ? (
          <Empty message="Nothing reinvested at the moment." />
        ) : (
          <Table>
            <thead>
              <tr><Th>Project</Th><Th>Status</Th><Th right>Reinvested on</Th><Th right>Amount</Th></tr>
            </thead>
            <tbody>
              {deployed.map((d) => {
                const p = d.projects as unknown as {
                  id: string; name: string; completed_at: string | null;
                };
                return (
                  <tr key={d.id} className="hover:bg-[var(--hover)]">
                    <Td className="font-medium">
                      <Link href={`/projects/${p.id}`} className="hover:text-[var(--brand)] hover:underline">
                        {p.name}
                      </Link>
                    </Td>
                    <Td className="text-xs text-[var(--muted)]">
                      {p.completed_at ? "Finished, awaiting payment" : "In progress"}
                    </Td>
                    <Td right className="text-xs text-[var(--muted)]">{date(d.funded_on)}</Td>
                    <Td right className="font-medium">{money(num(d.amount))}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Ledger" subtitle="Every movement in and out of the pool, newest first" />
        {!entries?.length ? (
          <Empty message="No movements yet." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th><Th>Member</Th><Th>Movement</Th><Th>Project</Th>
                <Th right>Amount</Th><Th right>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const m = e.capital_pool_members as unknown as { name: string } | null;
                const p = e.projects as unknown as { id: string; name: string } | null;
                return (
                  <tr key={e.id} className="hover:bg-[var(--hover)]">
                    <Td className="text-xs">{date(e.entry_date)}</Td>
                    <Td className="font-medium">{m?.name ?? "—"}</Td>
                    <Td className="text-xs text-[var(--muted)]">
                      {e.origin === "salary" ? "Salary" : ENTRY_LABEL[e.entry_type] ?? e.entry_type}
                      {e.note ? ` · ${e.note}` : ""}
                    </Td>
                    <Td className="text-xs">
                      {p ? (
                        <Link href={`/projects/${p.id}`} className="hover:text-[var(--brand)] hover:underline">
                          {p.name}
                        </Link>
                      ) : "—"}
                    </Td>
                    <Td right className={num(e.amount) < 0 ? "text-red-700" : ""}>{money(num(e.amount))}</Td>
                    <Td right>
                      {e.origin === "manual" ? (
                        <RemoveEntry id={e.id} />
                      ) : e.origin === "salary" ? (
                        <Link href="/payroll" className="text-xs text-[var(--muted)] hover:underline">salaries</Link>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
