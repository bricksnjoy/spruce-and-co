"use client";

import { useState, useTransition } from "react";
import { addTaxPayment, deleteBankStatement, importBankStatement, markBankLines, type BooksResult } from "@/app/actions/books";
import { parseStatement, type ParsedStatement } from "@/lib/bank-csv";
import { date, money } from "@/lib/format";

interface Item {
  key: string;
  memo: string;
  date: string | null;
  amount: number | null;
}

export interface LineView {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: "open" | "matched" | "explained";
  note: string | null;
  matched: Item | null;
  suggestion: Item | null;
}

const field = "rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1 text-sm text-[var(--text)]";
const DAY = 86_400_000;

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<BooksResult>, after?: (r: BooksResult) => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else after?.(r);
    });
  return { pending, error, run };
}

export function BankUpload() {
  const [file, setFile] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [account, setAccount] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const { pending, error, run } = useRun();
  const [readError, setReadError] = useState<string | null>(null);

  const read = async (f: File | undefined) => {
    setParsed(null);
    setMsg(null);
    setReadError(null);
    if (!f) return;
    setFile(f.name);
    try {
      setParsed(parseStatement(await f.text()));
    } catch (e) {
      setReadError(e instanceof Error ? e.message : "Could not read the file.");
    }
  };
  const lines = parsed?.lines ?? [];
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date));
  const closing = [...sorted].reverse().find((l) => l.balance !== null)?.balance ?? null;

  return (
    <div className="space-y-3 px-5 py-4 text-sm">
      <input type="file" accept=".csv,text/csv" onChange={(e) => read(e.target.files?.[0])}
        className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brand)] file:px-3 file:py-1.5 file:text-white" />
      {readError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{readError}</p>}
      {parsed && (
        <>
          <div className="rounded-lg bg-[var(--hover)] px-3 py-2 text-xs">
            <p><b>{lines.length}</b> transactions, {date(sorted[0]?.date)} – {date(sorted[sorted.length - 1]?.date)}</p>
            <p>In {money(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0))} · out {money(-lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0))}</p>
            {closing !== null && <p>Closing balance {money(closing)}</p>}
            <p className="mt-1 text-[var(--muted)]">Columns read: {Object.entries(parsed.columns).map(([k, v]) => `${k} = “${v}”`).join(", ")}{parsed.skipped ? ` · ${parsed.skipped} rows skipped` : ""}</p>
          </div>
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Account, e.g. BML current 7730…" className={`${field} w-full`} />
          <button type="button" disabled={pending || !lines.length}
            onClick={() => run(() => importBankStatement({ fileName: file, account, closing }, lines), (r) => {
              setMsg(`${r.done} new lines added${(r.done ?? 0) < lines.length ? `, ${lines.length - (r.done ?? 0)} were already in` : ""}.`);
              setParsed(null);
            })}
            className="rounded-lg bg-[var(--brand)] px-3 py-1.5 font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
            {pending ? "Adding…" : `Add ${lines.length} lines`}
          </button>
        </>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
      {msg && <p className="text-xs text-emerald-700">{msg}</p>}
    </div>
  );
}

export function AutoMatch({ pairs }: { pairs: { id: string; ref: string }[] }) {
  const { pending, error, run } = useRun();
  return (
    <span className="ml-auto flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button type="button" disabled={pending}
        onClick={() => run(() => markBankLines(pairs.map((p) => ({ id: p.id, status: "matched", ref: p.ref }))))}
        className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
        {pending ? "Matching…" : `Accept ${pairs.length} suggested matches`}
      </button>
    </span>
  );
}

export function RemoveStatement({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="text-xs">
      {error && <span className="mr-2 text-red-700">{error}</span>}
      <button type="button" disabled={pending} className="text-[var(--muted)] hover:text-red-700"
        onClick={() => { if (confirm("Remove this statement and all its lines, with their matches?")) run(() => deleteBankStatement(id)); }}>
        Remove
      </button>
    </span>
  );
}

export function BankLines({ lines, candidates }: { lines: LineView[]; candidates: Item[] }) {
  return (
    <ul className="divide-y divide-[var(--border)]">
      {lines.map((l) => <BankLineRow key={l.id} line={l} candidates={candidates} />)}
    </ul>
  );
}

function BankLineRow({ line: l, candidates }: { line: LineView; candidates: Item[] }) {
  const [mode, setMode] = useState<null | "match" | "explain" | "tax">(null);
  const [note, setNote] = useState("");
  const [pick, setPick] = useState("");
  const { pending, error, run } = useRun();
  const t = Date.parse(`${l.date}T00:00:00Z`);
  const options = mode === "match"
    ? candidates
        .filter((c) => c.date && Math.sign(c.amount ?? 0) === Math.sign(l.amount) && Math.abs(Date.parse(`${c.date}T00:00:00Z`) - t) <= 62 * DAY)
        .sort((a, b) => Math.abs((a.amount ?? 0) - l.amount) - Math.abs((b.amount ?? 0) - l.amount) || Math.abs(Date.parse(`${a.date}T00:00:00Z`) - t) - Math.abs(Date.parse(`${b.date}T00:00:00Z`) - t))
        .slice(0, 60)
    : [];

  return (
    <li className="px-5 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-24 shrink-0 text-xs text-[var(--muted)]">{date(l.date)}</span>
        <span className="min-w-0 flex-1 truncate" title={l.description}>{l.description || "—"}</span>
        <span className={`w-32 text-right font-medium tabular-nums ${l.amount > 0 ? "text-emerald-700" : ""}`}>{money(l.amount)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-0 text-xs sm:pl-[108px]">
        {l.status === "matched" && l.matched && (
          <>
            <span className="text-emerald-700">✓ {l.matched.memo}{l.matched.date ? ` · ${date(l.matched.date)}` : ""}{l.matched.amount !== null && Math.abs(l.matched.amount - l.amount) >= 0.01 ? ` · books ${money(l.matched.amount)}` : ""}</span>
            <button type="button" disabled={pending} className="text-[var(--muted)] hover:underline" onClick={() => run(() => markBankLines([{ id: l.id, status: "open" }]))}>Undo</button>
          </>
        )}
        {l.status === "explained" && (
          <>
            <span className="text-slate-700">Explained: “{l.note}”</span>
            <button type="button" disabled={pending} className="text-[var(--muted)] hover:underline" onClick={() => run(() => markBankLines([{ id: l.id, status: "open" }]))}>Undo</button>
          </>
        )}
        {l.status === "open" && (
          <>
            {l.suggestion && (
              <button type="button" disabled={pending} className="rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 hover:bg-emerald-100"
                onClick={() => run(() => markBankLines([{ id: l.id, status: "matched", ref: l.suggestion!.key }]))}>
                Match: {l.suggestion.memo} · {date(l.suggestion.date)}
              </button>
            )}
            <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => setMode(mode === "match" ? null : "match")}>Find a match</button>
            <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => setMode(mode === "explain" ? null : "explain")}>Explain</button>
            {l.amount < 0 && <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => setMode(mode === "tax" ? null : "tax")}>Record as tax paid</button>}
          </>
        )}
        {error && <span className="text-red-700">{error}</span>}
      </div>

      {mode === "match" && l.status === "open" && (
        <div className="mt-2 flex flex-wrap gap-2 sm:pl-[108px]">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${field} min-w-0 flex-1`}>
            <option value="">{options.length ? "Choose the entry in the books…" : "Nothing in the books within two months with that sign"}</option>
            {options.map((o) => <option key={o.key} value={o.key}>{date(o.date)} · {money(o.amount)} · {o.memo}</option>)}
          </select>
          <button type="button" disabled={!pick || pending} className="rounded-md bg-[var(--brand)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            onClick={() => run(() => markBankLines([{ id: l.id, status: "matched", ref: pick }]), () => setMode(null))}>Match</button>
        </div>
      )}
      {mode === "explain" && l.status === "open" && (
        <div className="mt-2 flex flex-wrap gap-2 sm:pl-[108px]">
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. transfer to our savings account, bank charge"
            className={`${field} min-w-0 flex-1`} />
          <button type="button" disabled={pending} className="rounded-md bg-[var(--brand)] px-2.5 py-1 text-xs font-medium text-white"
            onClick={() => run(() => markBankLines([{ id: l.id, status: "explained", note }]), () => setMode(null))}>Save</button>
        </div>
      )}
      {mode === "tax" && l.status === "open" && (
        <form className="mt-2 flex flex-wrap gap-2 sm:pl-[108px]"
          action={(fd) => run(() => addTaxPayment(null, fd), () => setMode(null))}>
          <input type="hidden" name="bank_line_id" value={l.id} />
          <input type="hidden" name="paid_on" value={l.date} />
          <input type="hidden" name="amount" value={Math.abs(l.amount)} />
          <select name="kind" className={field} defaultValue="gst">
            <option value="gst">GST</option>
            <option value="bpt">Business profit tax</option>
            <option value="other">Other tax or fee</option>
          </select>
          <input name="period" placeholder="Period, e.g. 2026 Q2" className={`${field} w-36`} />
          <input name="reference" placeholder="MIRA reference" className={`${field} w-36`} />
          <button type="submit" disabled={pending} className="rounded-md bg-[var(--brand)] px-2.5 py-1 text-xs font-medium text-white">Record {money(Math.abs(l.amount))}</button>
        </form>
      )}
    </li>
  );
}
