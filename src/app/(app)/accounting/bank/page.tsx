import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { date, money } from "@/lib/format";
import { loadBooks } from "@/lib/statements-data";
import { cashItems, type CashItem } from "@/lib/statements";
import { AccountingTabs } from "../nav";
import { BankLines, BankUpload, AutoMatch, RemoveStatement, type LineView } from "./bank-client";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const gap = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY;

export default async function BankPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show = "open" } = await searchParams;
  const supabase = await createClient();
  const [{ L }, { data: lines }, { data: statements }] = await Promise.all([
    loadBooks(supabase),
    supabase.from("bank_lines").select("id, statement_id, line_date, description, amount, balance, status, match_ref, note").order("line_date", { ascending: false }).limit(5000),
    supabase.from("bank_statements").select("id, file_name, account, period_from, period_to, uploaded_at").order("uploaded_at", { ascending: false }),
  ]);
  const all = lines ?? [];
  const items = cashItems(L);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const used = new Set(all.filter((l) => l.status === "matched" && l.match_ref).map((l) => l.match_ref as string));

  // suggest a match for each open line: same amount, closest date within a week, each book entry used once
  const free = items.filter((i) => !used.has(i.key));
  const taken = new Set<string>();
  const suggestion = new Map<string, CashItem>();
  for (const l of [...all].filter((l) => l.status === "open").sort((a, b) => a.line_date.localeCompare(b.line_date))) {
    const best = free
      .filter((i) => !taken.has(i.key) && Math.abs(i.amount - Number(l.amount)) < 0.01 && gap(i.date, l.line_date) <= 7)
      .sort((a, b) => gap(a.date, l.line_date) - gap(b.date, l.line_date))[0];
    if (best) {
      taken.add(best.key);
      suggestion.set(l.id, best);
    }
  }

  const covered = (statements ?? []).filter((s) => s.period_from && s.period_to);
  const from = covered.map((s) => s.period_from as string).sort()[0];
  const to = covered.map((s) => s.period_to as string).sort().slice(-1)[0];
  const notInBank = from ? free.filter((i) => i.date >= from && i.date <= to && !taken.has(i.key)) : [];

  // the bank's balance on its last line, against the books' cash on the same day
  const withBalance = [...all].filter((l) => l.balance !== null).sort((a, b) => b.line_date.localeCompare(a.line_date));
  const last = withBalance[0];
  const bookCash = last ? L.filter((l) => l.acct === "cash" && l.date <= last.line_date).reduce((s, l) => s + l.amount, 0) : null;
  const open = all.filter((l) => l.status === "open");
  const matched = all.filter((l) => l.status === "matched").length;
  const explained = all.filter((l) => l.status === "explained").length;

  const shown = (show === "all" ? all : all.filter((l) => l.status === show)).slice(0, 400);
  const view: LineView[] = shown.map((l) => {
    const s = suggestion.get(l.id);
    const m = l.match_ref ? byKey.get(l.match_ref) : undefined;
    return {
      id: l.id,
      date: l.line_date,
      description: l.description,
      amount: Number(l.amount),
      status: l.status as LineView["status"],
      note: l.note,
      matched: l.match_ref ? { key: l.match_ref, memo: m?.memo ?? "an entry no longer in the books", date: m?.date ?? null, amount: m?.amount ?? null } : null,
      suggestion: s ? { key: s.key, memo: s.memo, date: s.date, amount: s.amount } : null,
    };
  });
  // what an open line could be matched to by hand: unmatched book entries within two months
  const candidates = free.map((i) => ({ key: i.key, memo: i.memo, date: i.date, amount: i.amount }));
  const autos = [...suggestion.entries()].map(([id, s]) => ({ id, ref: s.key }));

  const tabs: [string, string, number][] = [["open", "To match", open.length], ["matched", "Matched", matched], ["explained", "Explained", explained], ["all", "All", all.length]];

  return (
    <div>
      <PageHeader title="Accounting" subtitle="Tick off the bank statement against the books" />
      <AccountingTabs active="/accounting/bank" />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Bank balance" value={last ? money(Number(last.balance)) : "—"} hint={last ? `on ${date(last.line_date)}` : "upload a statement"} />
        <Stat label="Books say" value={bookCash === null ? "—" : money(bookCash)} hint={last ? `cash on ${date(last.line_date)}` : ""}
          tone={bookCash === null || !last ? "default" : Math.abs(bookCash - Number(last.balance)) < 1 ? "good" : "warn"} />
        <Stat label="Difference" value={bookCash === null || !last ? "—" : money(Number(last.balance) - bookCash)}
          hint="bank less books: missing entries show up here" tone={bookCash === null || !last ? "default" : Math.abs(bookCash - Number(last.balance)) < 1 ? "good" : "bad"} />
        <Stat label="Bank lines to match" value={String(open.length)} hint={`${suggestion.size} with a likely match`} tone={open.length ? "warn" : "good"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map(([k, label, n]) => (
              <Link key={k} href={`/accounting/bank?show=${k}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ${show === k ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}>
                {label} · {n}
              </Link>
            ))}
            {autos.length > 0 && <AutoMatch pairs={autos} />}
          </div>
          <Card>
            <BankLines lines={view} candidates={candidates} />
            {!all.length && <p className="px-5 py-10 text-center text-sm text-[var(--muted)]">Upload a bank statement to start.</p>}
          </Card>

          {notInBank.length > 0 && (
            <Card>
              <CardHeader title="In the books but not on the bank statement"
                subtitle={`${notInBank.length} entries between ${date(from)} and ${date(to)}: paid in cash, from another account, or recorded wrongly`} />
              <ul className="max-h-[480px] divide-y divide-[var(--border)] overflow-y-auto text-sm">
                {notInBank.map((i) => (
                  <li key={i.key} className="flex items-center gap-3 px-5 py-2">
                    <span className="w-24 shrink-0 text-xs text-[var(--muted)]">{date(i.date)}</span>
                    <span className="min-w-0 flex-1 truncate">{i.memo}</span>
                    <span className={`w-32 text-right tabular-nums ${i.amount < 0 ? "" : "text-emerald-700"}`}>{money(i.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Upload a statement" subtitle="The CSV export from internet banking" />
            <BankUpload />
          </Card>
          <Card>
            <CardHeader title="Statements uploaded" />
            <ul className="divide-y divide-[var(--border)] text-sm">
              {(statements ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.account || s.file_name || "Statement"}</span>
                    <span className="block text-xs text-[var(--muted)]">{date(s.period_from)} – {date(s.period_to)}</span>
                  </span>
                  <RemoveStatement id={s.id} />
                </li>
              ))}
              {!statements?.length && <li className="px-5 py-3 text-xs text-[var(--muted)]">None yet.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="How it works" />
            <ul className="list-disc space-y-1.5 px-5 py-4 pl-9 text-xs text-[var(--muted)]">
              <li>Each bank line is matched to a payment in the books: a bill paid, a client payment, a salary, capital, a profit share or tax.</li>
              <li>Likely matches (same amount within a week) are suggested; accept them all at once or one by one.</li>
              <li>A line with nothing in the books means something is missing: record it where it belongs, then match it. Or explain it, such as a transfer between your own accounts.</li>
              <li>Uploading the same statement twice is safe: lines already in are skipped.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
