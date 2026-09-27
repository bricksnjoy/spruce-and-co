import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { money, date } from "@/lib/format";
import { buildLedger, KIND_LABEL, loadRecords, periodOf, type EntryKind } from "@/lib/accounting";
import { AccountingTabs, PeriodPicker } from "../nav";
import { filterEntries, type LedgerFilter } from "./filter";

export const dynamic = "force-dynamic";

const field = "rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 text-sm";

export default async function LedgerPage({ searchParams }: { searchParams: Promise<LedgerFilter> }) {
  const f = await searchParams;
  const period = periodOf(f);
  const supabase = await createClient();
  const records = await loadRecords(supabase);
  const all = buildLedger(records);
  const rows = filterEntries(all, f, period.from, period.to);
  // cash held before the first line shown, so the running balance is the real one
  const unfiltered = !f.kind && !f.account && !f.project && !f.q;
  const opening = all.filter((e) => e.cash && e.date < period.from).reduce((s, e) => s + e.amount, 0);
  const balances = rows.reduce<number[]>((acc, e) => [...acc, (acc.at(-1) ?? opening) + (e.cash ? e.amount : 0)], []);
  const moneyIn = rows.filter((e) => e.cash && e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const moneyOut = rows.filter((e) => e.cash && e.amount < 0).reduce((s, e) => s - e.amount, 0);
  const accounts = [...new Set(all.map((e) => e.account))].sort();
  const keep = { kind: f.kind, account: f.account, project: f.project, q: f.q, transfers: f.transfers };
  const csv = `/accounting/ledger/csv?${new URLSearchParams(Object.entries({ ...keep, p: period.key, from: period.from, to: period.to }).filter(([, v]) => v) as [string, string][]).toString()}`;

  return (
    <div>
      <PageHeader title="Accounting" subtitle="Every movement of money, in one book" />
      <AccountingTabs active="/accounting/ledger" />
      <div className="mb-4"><PeriodPicker path="/accounting/ledger" period={period} keep={keep} /></div>

      <form action="/accounting/ledger" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="p" value={period.key} />
        {period.key === "custom" && (
          <>
            <input type="hidden" name="from" value={period.from} />
            <input type="hidden" name="to" value={period.to} />
          </>
        )}
        <input name="q" defaultValue={f.q ?? ""} placeholder="Search description, supplier, project…" className={`${field} w-64`} aria-label="Search" />
        <select name="kind" defaultValue={f.kind ?? ""} className={field} aria-label="Type">
          <option value="">All types</option>
          {(Object.keys(KIND_LABEL) as EntryKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select name="account" defaultValue={f.account ?? ""} className={field} aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select name="project" defaultValue={f.project ?? ""} className={field} aria-label="Project">
          <option value="">All projects</option>
          {records.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 px-1 text-xs text-[var(--muted)]">
          <input type="checkbox" name="transfers" value="1" defaultChecked={f.transfers === "1"} className="accent-[var(--brand)]" />
          Show transfers
        </label>
        <button type="submit" className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white">Filter</button>
        <Link href={`/accounting/ledger?p=${period.key}`} className="px-1 text-xs text-[var(--muted)] hover:underline">Clear</Link>
        <a href={csv} className="ml-auto text-sm font-medium text-[var(--brand)] hover:underline">Download CSV</a>
      </form>

      <Card>
        <div className="grid grid-cols-2 gap-px border-b border-[var(--border)] bg-[var(--border)] text-sm sm:grid-cols-4">
          {[
            ["Lines", String(rows.length)],
            ["Money in", money(moneyIn)],
            ["Money out", money(moneyOut)],
            ["Net", money(moneyIn - moneyOut)],
          ].map(([k, v]) => (
            <div key={k} className="bg-[var(--surface)] px-5 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{k}</p>
              <p className="font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                <th className="px-5 py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Account</th>
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 font-medium">Project</th>
                <th className="py-2 pr-3 text-right font-medium">In</th>
                <th className="py-2 pr-3 text-right font-medium">Out</th>
                {unfiltered && <th className="py-2 pr-5 text-right font-medium">Cash balance</th>}
              </tr>
            </thead>
            <tbody>
              {unfiltered && period.key !== "all" && (
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <td className="px-5 py-2" colSpan={6}>Brought forward</td>
                  <td className="py-2 pr-5 text-right tabular-nums">{money(opening)}</td>
                </tr>
              )}
              {rows.map((e, i) => {
                return (
                  <tr key={e.id} className={`border-b border-[var(--border)] ${e.cash ? "" : "text-[var(--muted)]"}`}>
                    <td className="whitespace-nowrap px-5 py-2 text-xs">{date(e.date)}</td>
                    <td className="py-2 pr-3">
                      <span className="block">{e.account}</span>
                      <span className="text-[11px] text-[var(--muted)]">{KIND_LABEL[e.kind]}</span>
                    </td>
                    <td className="max-w-[340px] py-2 pr-3">
                      <Link href={e.href} className="block truncate hover:underline" title={e.description}>{e.description}</Link>
                      {e.party && <span className="block truncate text-[11px] text-[var(--muted)]">{e.party}</span>}
                    </td>
                    <td className="py-2 pr-3 text-xs">{e.project ? <Link href={`/projects/${e.project.id}`} className="hover:underline">{e.project.code}</Link> : "—"}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-emerald-700">{e.amount > 0 ? money(e.amount) : ""}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{e.amount < 0 ? money(-e.amount) : ""}</td>
                    {unfiltered && <td className="whitespace-nowrap py-2 pr-5 text-right tabular-nums">{e.cash ? money(balances[i]) : "no cash"}</td>}
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-[var(--muted)]">Nothing matches.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Transfers move money inside the business without it leaving — a partner&apos;s profit share kept as capital, or a share owed on completion.
        They are hidden unless asked for, and never change the cash balance.
      </p>
    </div>
  );
}
