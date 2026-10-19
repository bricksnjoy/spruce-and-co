"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { input, label, primary, small } from "@/components/form-styles";
import { saveJournal, voidJournal, type Result } from "@/app/actions/journal";
import { money, today } from "@/lib/format";
import { laariToNumber, toLaari } from "@/lib/money";

type Opt = { id: string; name: string };
type L = { key: number; account_id: string; description: string; debit: string; credit: string; contact_id: string; project_id: string };
const blank = (key: number): L => ({ key, account_id: "", description: "", debit: "", credit: "", contact_id: "", project_id: "" });

/** Journal entry or opening balances: a grid of debit and credit lines with running totals. */
export function JournalForm({ accounts, contacts, projects, opening }: { accounts: Opt[]; contacts: Opt[]; projects: Opt[]; opening: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: Result | null, fd: FormData) => {
    const r = await saveJournal(prev, fd);
    if (r.ok && r.id) router.push(`/reports/journal?txn=${r.id}`);
    return r;
  }, null);
  const [lines, setLines] = useState<L[]>([blank(1), blank(2), blank(3)]);
  const set = (k: number, patch: Partial<L>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const sum = (f: "debit" | "credit") => lines.reduce((t, l) => t + (toLaari(l[f]) ?? 0n), 0n);
  const diff = sum("debit") - sum("credit");
  const sel = (value: string, onChange: (v: string) => void, opts: Opt[], placeholder: string, aria: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={aria} className={`${input} py-1 text-xs`}>
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("lines", JSON.stringify(lines)); startTransition(() => action(fd)); }} className="space-y-4 px-5 py-4">
      <input type="hidden" name="type" value={opening ? "opening_balance" : "journal"} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label htmlFor="j-date" className={label}>Date</label><input id="j-date" name="date" type="date" required defaultValue={today()} className={input} /></div>
        <div><label htmlFor="j-no" className={label}>Number</label><input id="j-no" name="number" placeholder="Automatic" className={input} /></div>
        <div><label htmlFor="j-memo" className={label}>Memo</label><input id="j-memo" name="memo" className={input} /></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-[var(--muted)]">
            <th className="py-1.5 pr-2 font-medium">Account</th><th className="pr-2 font-medium">Description</th><th className="pr-2 text-right font-medium">Debit</th>
            <th className="pr-2 text-right font-medium">Credit</th><th className="pr-2 font-medium">Name</th><th className="pr-2 font-medium">Project</th><th />
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key}>
                <td className="min-w-[14rem] py-1 pr-2">{sel(l.account_id, (v) => set(l.key, { account_id: v }), accounts, "Choose…", `Line ${i + 1} account`)}</td>
                <td className="min-w-[10rem] pr-2"><input value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} aria-label={`Line ${i + 1} description`} className={`${input} py-1 text-xs`} /></td>
                <td className="pr-2"><input value={l.debit} inputMode="decimal" onChange={(e) => set(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} aria-label={`Line ${i + 1} debit`} className={`${input} w-28 py-1 text-right text-xs tabular-nums`} /></td>
                <td className="pr-2"><input value={l.credit} inputMode="decimal" onChange={(e) => set(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} aria-label={`Line ${i + 1} credit`} className={`${input} w-28 py-1 text-right text-xs tabular-nums`} /></td>
                <td className="min-w-[9rem] pr-2">{sel(l.contact_id, (v) => set(l.key, { contact_id: v }), contacts, "—", `Line ${i + 1} name`)}</td>
                <td className="min-w-[9rem] pr-2">{sel(l.project_id, (v) => set(l.key, { project_id: v }), projects, "—", `Line ${i + 1} project`)}</td>
                <td><button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`} className="text-xs text-[var(--muted)] hover:text-red-700">✕</button></td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-2"><button type="button" onClick={() => setLines((ls) => [...ls, blank(Math.max(0, ...ls.map((x) => x.key)) + 1)])} className={small}>Add line</button></td>
              <td className="text-right text-xs text-[var(--muted)]">Totals</td>
              <td className="pr-2 text-right tabular-nums">{money(laariToNumber(sum("debit")))}</td>
              <td className="pr-2 text-right tabular-nums">{money(laariToNumber(sum("credit")))}</td>
              <td colSpan={3} className={`text-xs ${diff !== 0n && !opening ? "text-red-700" : "text-[var(--muted)]"}`}>
                {diff === 0n ? "Balanced" : opening ? `Difference ${money(laariToNumber(diff < 0n ? -diff : diff))} goes to Opening Balance Equity` : `Out by ${money(laariToNumber(diff < 0n ? -diff : diff))}`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || (!opening && diff !== 0n)} className={primary}>{pending ? "Posting…" : opening ? "Post opening balances" : "Post journal entry"}</button>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </div>
    </form>
  );
}

export function VoidJournal({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-red-700 hover:underline">Void…</button>;
  return (
    <span className="inline-flex items-center gap-2">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why void it?" aria-label="Reason for voiding" className={`${input} w-40 py-1`} />
      <button type="button" disabled={pending} onClick={() => { if (confirm("Void this entry? It stays on record, marked void.")) start(async () => { const r = await voidJournal(id, reason); setError(r.error ?? null); if (!r.error) setOpen(false); }); }}
        className={`${small} border-red-300 text-red-700`}>Void</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
