import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { PrintToolbar } from "../../toolbar";
import { LedgerSheet, sheetAccent, sheetTh, type Company } from "@/components/sales/ledger-sheet";
import { dbToLaari, laariToNumber } from "@/lib/money";

export const dynamic = "force-dynamic";
const n2 = (v: bigint) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(laariToNumber(v));
const d = (s: string | null | undefined) => s ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${s.slice(0, 10)}T00:00:00Z`)) : "";
const label = (t: string | null | undefined) => (t ? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "");
type JL = { id: number; date: string; debit: number; credit: number; memo: string | null; cleared: string; reconciliation_id: string | null;
  transactions: { type: string; number: string | null } | null; contacts: { name: string } | null };

/** Reconciliation report: what the statement showed, the items it cleared, and what was still outstanding at that date. */
export default async function PrintReconciliation({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: r } = await s.supabase.from("reconciliations").select("id, account_id, statement_date, ending_balance, status, completed_at").eq("id", id).maybeSingle();
  if (!r) notFound();
  const [{ data: a }, { data: company }, { data: lines }] = await Promise.all([
    s.supabase.from("accounts").select("code, name, currency").eq("id", r.account_id).maybeSingle(),
    s.supabase.from("company").select("legal_name, trade_name, tin, gst_registered, taxable_activity_no, address, phone, email, bank_details").eq("id", true).maybeSingle(),
    s.supabase.from("journal_lines").select("id, date, debit, credit, memo, cleared, reconciliation_id, transactions(type, number), contacts(name)")
      .eq("account_id", r.account_id).lte("date", r.statement_date).order("date").order("id").limit(5000),
  ]);
  if (!a || !company) notFound();
  const jls = (lines ?? []) as unknown as JL[];
  const amt = (l: JL) => dbToLaari(l.debit) - dbToLaari(l.credit);
  const cleared = jls.filter((l) => l.reconciliation_id === id);
  const outstanding = jls.filter((l) => l.cleared !== "reconciled" && l.reconciliation_id !== id);
  const ending = dbToLaari(r.ending_balance);
  const clearedTotal = cleared.reduce((t, l) => t + amt(l), 0n);
  const outTotal = outstanding.reduce((t, l) => t + amt(l), 0n);
  const bookBalance = jls.reduce((t, l) => t + amt(l), 0n);
  const title = `Reconciliation ${a.code} ${r.statement_date}`;
  const items = (rows: JL[], heading: string) => (
    <>
      <p className="mt-6 text-[10.5px] font-semibold">{heading} ({rows.length})</p>
      <table className="mt-2 w-full border-collapse text-[9.5px]">
        <thead><tr style={{ background: sheetAccent }}>
          <th className={sheetTh}>Date</th><th className={sheetTh}>Document</th><th className={sheetTh}>Name / memo</th><th className={`${sheetTh} text-right`}>Amount</th>
        </tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="border-b border-[#c9ced6]">
              <td className="px-2 py-1.5">{d(l.date)}</td>
              <td className="px-2 py-1.5">{`${label(l.transactions?.type)} ${l.transactions?.number ?? ""}`}</td>
              <td className="px-2 py-1.5">{[l.contacts?.name, l.memo].filter(Boolean).join(" · ")}</td>
              <td className="px-2 py-1.5 text-right">{n2(amt(l))}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="px-2 py-2 text-[#5b6675]">None.</td></tr>}
        </tbody>
      </table>
    </>
  );
  return (
    <>
      <title>{title}</title>
      <PrintToolbar back={`/banking/${r.account_id}?tab=reconcile`} filename={title} />
      <LedgerSheet company={company as Company} title="RECONCILIATION">
        <div className="flex items-start justify-between gap-6 text-[10.5px]">
          <div>
            <p className="font-semibold">{a.code} · {a.name}{a.currency !== "MVR" ? ` (${a.currency})` : ""}</p>
            <p>Statement date {d(r.statement_date)}</p>
          </div>
          <p className="text-right">{r.status === "completed" ? `Finished ${d(r.completed_at)}` : label(r.status)}</p>
        </div>
        <table className="mt-5 w-full text-[10.5px]">
          <tbody>
            <tr><td className="py-1">Statement ending balance</td><td className="py-1 text-right font-semibold">{n2(ending)}</td></tr>
            <tr><td className="py-1">Cleared in this reconciliation</td><td className="py-1 text-right">{n2(clearedTotal)}</td></tr>
            <tr><td className="py-1">Not yet cleared at the statement date</td><td className="py-1 text-right">{n2(outTotal)}</td></tr>
            <tr className="border-t border-[#c9ced6]"><td className="py-1">Balance in the books at the statement date</td><td className="py-1 text-right font-semibold">{n2(bookBalance)}</td></tr>
          </tbody>
        </table>
        {items(cleared, "Cleared items")}
        {items(outstanding, "Items not yet cleared")}
      </LedgerSheet>
    </>
  );
}
