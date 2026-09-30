"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { input, small } from "@/components/form-styles";
import { addFromLine, matchLine, unmatchLine } from "@/app/actions/banking";
import { date, money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { ruleFor, type BankRule } from "@/lib/bank-rules";

export type StatementLine = { id: string; date: string; description: string; amount: number; balance: number | null; status: string;
  journal_line_id: number | null; transaction_id: string | null; doc?: { href: string | null; label: string } | null };
export type Candidate = { id: string; date: string; amount: string; label: string };
type Opt = { id: string; name?: string; code?: string };

const days = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const FILTERS = [["open", "To review"], ["matched", "Matched"], ["added", "Added"], ["excluded", "Excluded"], ["all", "All"]] as const;

/** Each statement line: match it to the books, add it, or exclude it. */
export function ReviewLines({ lines, candidates, rules, accounts, contacts, projects, canEdit }: {
  lines: StatementLine[]; candidates: Candidate[]; rules: BankRule[]; accounts: (Opt & { type?: string })[]; contacts: Opt[]; projects: Opt[]; canEdit: boolean;
}) {
  const [show, setShow] = useState<(typeof FILTERS)[number][0]>("open");
  const shown = lines.filter((l) => show === "all" || l.status === show);
  const count = (st: string) => lines.filter((l) => l.status === st).length;
  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-[var(--border)] px-5 py-3">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setShow(k)} className={`rounded-full px-3 py-1 text-xs font-medium ${show === k ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}>
            {l}{k !== "all" ? ` (${count(k)})` : ""}
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">{show === "open" ? "Nothing left to review." : "None."}</p>
        : <div className="divide-y divide-[var(--border)]">{shown.map((l) => <Row key={l.id} line={l} candidates={candidates} rules={rules} accounts={accounts} contacts={contacts} projects={projects} canEdit={canEdit} />)}</div>}
    </Card>
  );
}

function Row({ line, candidates, rules, accounts, contacts, projects, canEdit }: {
  line: StatementLine; candidates: Candidate[]; rules: BankRule[]; accounts: (Opt & { type?: string })[]; contacts: Opt[]; projects: Opt[]; canEdit: boolean;
}) {
  const amt = dbToLaari(line.amount);
  const rule = ruleFor(rules, line);
  const matches = candidates.filter((c) => BigInt(c.amount) === amt && days(c.date, line.date) <= 60).sort((a, b) => days(a.date, line.date) - days(b.date, line.date));
  const [mode, setMode] = useState<"match" | "add" | null>(null);
  const [pick, setPick] = useState(matches[0]?.id ?? "");
  const [acct, setAcct] = useState(rule?.account_id ?? "");
  const [contact, setContact] = useState(rule?.contact_id ?? "");
  const [project, setProject] = useState(rule?.project_id ?? "");
  const [memo, setMemo] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); setError(r.error ?? null); if (!r.error) setMode(null); });

  return (
    <div className="px-5 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 shrink-0 text-[var(--muted)]">{date(line.date)}</span>
        <span className="min-w-0 flex-1 truncate" title={line.description}>{line.description}</span>
        <span className={`w-32 text-right font-medium tabular-nums ${amt < 0n ? "" : "text-emerald-700"}`}>{amt < 0n ? "−" : "+"}{money(laariToNumber(amt < 0n ? -amt : amt))}</span>
        <span className="w-64 text-right">
          {line.status === "open" && canEdit && (
            <span className="inline-flex flex-wrap justify-end gap-2">
              {matches.length > 0 && <button type="button" className={small} onClick={() => setMode(mode === "match" ? null : "match")}>Match{matches.length === 1 ? "" : ` (${matches.length})`}</button>}
              <button type="button" className={small} onClick={() => setMode(mode === "add" ? null : "add")}>Add{rule ? ` · ${rule.name}` : ""}</button>
              <button type="button" disabled={pending} className="text-xs text-[var(--muted)] hover:underline" onClick={() => run(() => unmatchLine(line.id, "excluded"))}>Exclude</button>
            </span>
          )}
          {line.status !== "open" && (
            <span className="inline-flex items-center justify-end gap-2 text-xs">
              {line.doc && (line.doc.href ? <Link href={line.doc.href} className="text-[var(--brand)] hover:underline">{line.doc.label}</Link> : <span>{line.doc.label}</span>)}
              <span className="rounded-full bg-[var(--hover)] px-2 py-0.5">{line.status}</span>
              {canEdit && line.status !== "added" && <button type="button" disabled={pending} className="text-[var(--muted)] hover:underline" onClick={() => run(() => unmatchLine(line.id, "open"))}>Undo</button>}
            </span>
          )}
        </span>
      </div>
      {mode === "match" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-24">
          <select aria-label="Entry in the books" value={pick} onChange={(e) => setPick(e.target.value)} className={`${input} w-96 py-1`}>
            {matches.map((c) => <option key={c.id} value={c.id}>{date(c.date)} · {c.label}</option>)}
          </select>
          <button type="button" disabled={pending || !pick} className={small} onClick={() => run(() => matchLine(line.id, pick))}>Match</button>
        </div>
      )}
      {mode === "add" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-24">
          <select aria-label="What it was for" value={acct} onChange={(e) => setAcct(e.target.value)} className={`${input} w-64 py-1`}>
            <option value="">What was it for?</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
          <select aria-label="Contact" value={contact} onChange={(e) => setContact(e.target.value)} className={`${input} w-48 py-1`}>
            <option value="">No contact</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className={`${input} w-32 py-1`}>
            <option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          <input aria-label="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Memo (optional)" className={`${input} w-48 py-1`} />
          <button type="button" disabled={pending || !acct} className={small} onClick={() => run(() => addFromLine(line.id, acct, contact, project, memo))}>
            Add as {amt < 0n ? "expense" : "money in"}
          </button>
        </div>
      )}
      {error && <p className="mt-1 pl-24 text-xs text-red-700">{error}</p>}
    </div>
  );
}
