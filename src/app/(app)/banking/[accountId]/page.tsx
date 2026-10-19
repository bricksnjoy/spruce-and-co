import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession, type Session } from "@/server/session";
import { date, money, titleize } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { docHref } from "@/lib/doc-href";
import type { BankRule } from "@/lib/bank-rules";
import { ReviewLines, type StatementLine, type Candidate } from "@/components/banking/review";
import { Reconcile, StartReconciliation, UndoButton } from "@/components/banking/reconcile";
import { ImportForm } from "@/components/banking/forms";

export const dynamic = "force-dynamic";
type Tab = "review" | "register" | "reconcile";
const TABS: [Tab, string][] = [["review", "Bank statement"], ["register", "Register"], ["reconcile", "Reconcile"]];
type JL = { id: number; date: string; debit: number; credit: number; memo: string | null; cleared: string; reconciliation_id: string | null; transaction_id: string;
  transactions: { type: string; number: string | null; memo: string | null } | null; contacts: { name: string } | null };

export default async function AccountPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ tab?: string; note?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ accountId }, { tab, note }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) notFound();
  const { data: a } = await s.supabase.from("accounts").select("id, code, name, subtype, currency").eq("id", accountId).maybeSingle();
  if (!a || !["bank", "cash", "credit_card"].includes(a.subtype ?? "")) notFound();
  const active: Tab = TABS.some(([k]) => k === tab) ? (tab as Tab) : "review";
  const writer = canWrite(s.role);
  const { data: lines } = await s.supabase.from("journal_lines")
    .select("id, date, debit, credit, memo, cleared, reconciliation_id, transaction_id, transactions(type, number, memo), contacts(name)")
    .eq("account_id", accountId).order("date").order("id").limit(3000);
  const jls = (lines ?? []) as unknown as JL[];
  const bookBalance = jls.reduce((t, l) => t + dbToLaari(l.debit) - dbToLaari(l.credit), 0n);

  return (
    <div className="max-w-6xl space-y-5">
      <Link href="/banking" className="text-xs text-[var(--muted)] hover:underline">← Banking</Link>
      <PageHeader title={a.name} subtitle={`${a.code}${a.currency !== "MVR" ? ` · ${a.currency}` : ""} · balance in the books ${money(laariToNumber(bookBalance))}`} />
      {note && <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">{note}</p>}
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/banking/${accountId}?tab=${k}`} className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${active === k ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>{l}</Link>
        ))}
      </div>
      {active === "review" && <Review s={s} accountId={accountId} jls={jls} writer={writer} />}
      {active === "register" && <Register jls={jls} />}
      {active === "reconcile" && <ReconcileTab s={s} accountId={accountId} jls={jls} writer={writer} />}
    </div>
  );
}

async function Review({ s, accountId, jls, writer }: { s: Session; accountId: string; jls: JL[]; writer: boolean }) {
  const [{ data: st }, { data: rules }, { data: accts }, { data: contacts }, { data: projects }] = await Promise.all([
    s.supabase.from("bank_statement_lines").select("id, date, description, amount, balance, status, journal_line_id, transaction_id").eq("account_id", accountId)
      .order("date", { ascending: false }).limit(400),
    s.supabase.from("bank_rules").select("*"),
    s.supabase.from("accounts").select("id, code, name, type").eq("active", true).is("contact_id", null).neq("id", accountId).order("code"),
    s.supabase.from("contacts").select("id, name").eq("active", true).order("name"),
    s.supabase.from("projects").select("id, code").is("archived_at", null).order("code"),
  ]);
  const claimed = new Set((st ?? []).map((l) => l.journal_line_id).filter(Boolean));
  const txMeta = new Map(jls.map((l) => [l.transaction_id, l.transactions]));
  const candidates: Candidate[] = jls.filter((l) => !claimed.has(l.id)).map((l) => ({
    id: String(l.id), date: l.date, amount: String(dbToLaari(l.debit) - dbToLaari(l.credit)),
    label: `${titleize(l.transactions?.type)} ${l.transactions?.number ?? ""}${l.contacts ? ` · ${l.contacts.name}` : ""}`.trim(),
  }));
  const rows = ((st ?? []) as StatementLine[]).map((l) => ({ ...l, doc: l.transaction_id ? { href: docHref(txMeta.get(l.transaction_id)?.type, l.transaction_id), label: `${titleize(txMeta.get(l.transaction_id)?.type)} ${txMeta.get(l.transaction_id)?.number ?? ""}` } : null }));
  return (
    <div className="space-y-5">
      {writer && <Card><CardHeader title="Import a statement" /><ImportForm accounts={[]} account={accountId} /></Card>}
      {rows.length === 0 ? <Card><Empty message="No statement lines yet. Import a CSV from your bank." /></Card> : (
        <ReviewLines lines={rows} candidates={candidates} rules={(rules ?? []) as BankRule[]} accounts={accts ?? []}
          contacts={contacts ?? []} projects={projects ?? []} canEdit={writer} />
      )}
    </div>
  );
}

function Register({ jls }: { jls: JL[] }) {
  const rows = jls.reduce<(JL & { running: bigint })[]>((acc, l) => {
    acc.push({ ...l, running: (acc.at(-1)?.running ?? 0n) + dbToLaari(l.debit) - dbToLaari(l.credit) });
    return acc;
  }, []).reverse();
  return (
    <Card>
      {rows.length === 0 ? <Empty message="Nothing has gone through this account yet." /> : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Document</Th><Th>Name / memo</Th><Th right>In</Th><Th right>Out</Th><Th right>Balance</Th><Th right>✓</Th></tr></thead>
          <tbody>
            {rows.map((l) => {
              const href = docHref(l.transactions?.type, l.transaction_id);
              const label = `${titleize(l.transactions?.type)} ${l.transactions?.number ?? ""}`;
              return (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap">{date(l.date)}</Td>
                  <Td>{href ? <Link href={href} className="hover:underline">{label}</Link> : label}</Td>
                  <Td className="text-xs text-[var(--muted)]">{[l.contacts?.name, l.memo ?? l.transactions?.memo].filter(Boolean).join(" · ")}</Td>
                  <Td right>{dbToLaari(l.debit) ? money(laariToNumber(dbToLaari(l.debit))) : ""}</Td>
                  <Td right>{dbToLaari(l.credit) ? money(laariToNumber(dbToLaari(l.credit))) : ""}</Td>
                  <Td right>{money(laariToNumber(l.running))}</Td>
                  <Td right><span title={l.cleared} className={l.cleared === "reconciled" ? "text-emerald-700" : l.cleared === "cleared" ? "text-blue-700" : "text-[var(--muted)]"}>{l.cleared === "reconciled" ? "R" : l.cleared === "cleared" ? "C" : "—"}</span></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function ReconcileTab({ s, accountId, jls, writer }: { s: Session; accountId: string; jls: JL[]; writer: boolean }) {
  const { data: recs } = await s.supabase.from("reconciliations").select("*").eq("account_id", accountId).order("statement_date", { ascending: false });
  const open = (recs ?? []).find((r) => r.status === "in_progress");
  const done = (recs ?? []).filter((r) => r.status === "completed");
  const reconciledBefore = jls.filter((l) => l.cleared === "reconciled").reduce((t, l) => t + dbToLaari(l.debit) - dbToLaari(l.credit), 0n);
  return (
    <div className="space-y-5">
      {open ? (
        <Reconcile recon={{ id: open.id, statement_date: open.statement_date, ending_balance: String(open.ending_balance) }} canEdit={writer}
          opening={String(reconciledBefore)}
          lines={jls.filter((l) => l.cleared !== "reconciled" && l.date <= open.statement_date).map((l) => ({
            id: String(l.id), date: l.date, amount: String(dbToLaari(l.debit) - dbToLaari(l.credit)), cleared: l.cleared === "cleared" && l.reconciliation_id === open.id,
            label: `${titleize(l.transactions?.type)} ${l.transactions?.number ?? ""}`, who: l.contacts?.name ?? l.memo ?? "" }))} />
      ) : writer ? <StartReconciliation accountId={accountId} /> : null}
      <Card>
        <CardHeader title="Past reconciliations" />
        {done.length === 0 ? <Empty message="None yet." /> : (
          <Table>
            <thead><tr><Th>Statement date</Th><Th right>Ending balance</Th><Th>Finished</Th><Th right> </Th></tr></thead>
            <tbody>
              {done.map((r, i) => (
                <tr key={r.id}>
                  <Td>{date(r.statement_date)}</Td>
                  <Td right>{money(laariToNumber(dbToLaari(r.ending_balance)))}</Td>
                  <Td className="text-xs text-[var(--muted)]">{r.completed_at ? date(r.completed_at) : ""}</Td>
                  <Td right><span className="inline-flex gap-3"><Link href={`/print/reconciliations/${r.id}`} className="text-xs font-medium text-[var(--brand)] hover:underline">Report</Link>
                    {writer && i === 0 && !open && <UndoButton id={r.id} />}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
