"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { billsPaidInFull, clearMark, deleteSignOff, markItem, signOff, type AuditResult } from "@/app/actions/audit";
import type { Check, Severity } from "@/lib/audit-checks";
import { money } from "@/lib/format";

export interface Mark {
  status: "ok" | "query";
  note: string | null;
  by: string | null;
  at: string;
}

const SEV: Record<Severity, { label: string; chip: string; dot: string }> = {
  high: { label: "High", chip: "bg-red-50 text-red-800", dot: "bg-red-600" },
  medium: { label: "Medium", chip: "bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  low: { label: "Low", chip: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
};

function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const run = (fn: () => Promise<AuditResult>, ok?: (r: AuditResult) => string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { error: r.error } : ok ? { ok: ok(r) } : null);
    });
  return { pending, msg, run };
}

/** One check: what it looks for, why, and every item it found, each to accept or query. */
export function CheckCard({ check, marks, startOpen }: { check: Check; marks: Record<string, Mark>; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [showAccepted, setShowAccepted] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { pending, msg, run } = useRun();
  const accepted = check.items.filter((i) => marks[i.id]?.status === "ok");
  const openItems = check.items.filter((i) => marks[i.id]?.status !== "ok");
  const queried = openItems.filter((i) => marks[i.id]?.status === "query").length;
  const atStake = openItems.reduce((s, i) => s + Math.abs(i.amount ?? 0), 0);
  const shown = showAccepted ? check.items : openItems;
  const clean = openItems.length === 0;

  return (
    <div className={`rounded-xl border ${clean ? "border-[var(--border)]" : check.severity === "high" ? "border-red-200" : "border-[var(--border)]"} bg-[var(--surface)]`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-3 px-5 py-3.5 text-left">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${clean ? "bg-emerald-500" : SEV[check.severity].dot}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{check.title}</span>
          <span className="block text-xs text-[var(--muted)]">{check.why}</span>
        </span>
        <span className="shrink-0 text-right">
          {clean ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Clear</span>
          ) : (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEV[check.severity].chip}`}>
              {openItems.length} to look at
            </span>
          )}
          {atStake > 0 && <span className="mt-1 block text-[11px] text-[var(--muted)]">{money(atStake)}</span>}
          {accepted.length > 0 && <span className="mt-0.5 block text-[11px] text-[var(--muted)]">{accepted.length} accepted</span>}
          {queried > 0 && <span className="mt-0.5 block text-[11px] font-medium text-amber-700">{queried} queried</span>}
        </span>
      </button>

      {open && (check.items.length > 0) && (
        <div className="border-t border-[var(--border)]">
          {msg?.error && <p className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{msg.error}</p>}
          {msg?.ok && <p className="mx-5 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{msg.ok}</p>}
          <div className="flex flex-wrap items-center gap-3 px-5 py-2 text-xs">
            {check.fix && openItems.length > 0 && (
              <button type="button" disabled={pending}
                onClick={() => { if (confirm(`${check.fix!.label}? Each change is kept in the change log.`)) run(() => billsPaidInFull(), (r) => `Done: ${r.done} bills updated.`); }}
                className="rounded-lg bg-[var(--brand)] px-3 py-1.5 font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
                {pending ? "Working…" : check.fix.label}
              </button>
            )}
            {openItems.length > 1 && check.severity === "low" && (
              <button type="button" disabled={pending} className="text-[var(--brand)] hover:underline"
                onClick={() => { if (confirm(`Accept all ${openItems.length} as they are?`)) run(() => markItem(check.key, openItems.map((i) => i.id), "ok", "")); }}>
                Accept all {openItems.length}
              </button>
            )}
            {accepted.length > 0 && (
              <button type="button" className="text-[var(--muted)] hover:underline" onClick={() => setShowAccepted((v) => !v)}>
                {showAccepted ? "Hide accepted" : `Show ${accepted.length} accepted`}
              </button>
            )}
          </div>
          <ul className="max-h-[420px] divide-y divide-[var(--border)] overflow-y-auto">
            {shown.slice(0, 200).map((i) => {
              const m = marks[i.id];
              return (
                <li key={i.id} className={`px-5 py-2 text-sm ${m?.status === "ok" ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link href={i.href} className="min-w-0 flex-1 truncate hover:underline">{i.label}</Link>
                    {i.amount !== undefined && <span className="tabular-nums text-[var(--muted)]">{money(i.amount)}</span>}
                    {m ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span className={m.status === "ok" ? "text-emerald-700" : "font-medium text-amber-700"}>
                          {m.status === "ok" ? "Accepted" : "Queried"}{m.by ? ` by ${m.by}` : ""}
                        </span>
                        <button type="button" disabled={pending} className="text-[var(--muted)] hover:underline" onClick={() => run(() => clearMark(check.key, i.id))}>Undo</button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-xs">
                        <button type="button" disabled={pending} className="font-medium text-emerald-700 hover:underline" onClick={() => run(() => markItem(check.key, [i.id], "ok", ""))}>Looks fine</button>
                        <button type="button" className="font-medium text-amber-700 hover:underline" onClick={() => { setAsking(i.id); setNote(""); }}>Query</button>
                      </span>
                    )}
                  </div>
                  {i.detail && <p className="truncate text-xs text-[var(--muted)]">{i.detail}</p>}
                  {m?.note && <p className="text-xs text-amber-800">“{m.note}”</p>}
                  {asking === i.id && (
                    <div className="mt-2 flex gap-2">
                      <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs looking into?"
                        className="flex-1 rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1 text-sm" />
                      <button type="button" disabled={pending} className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white"
                        onClick={() => run(() => markItem(check.key, [i.id], "query", note), () => { setAsking(null); return "Queried."; })}>Save</button>
                      <button type="button" className="text-xs text-[var(--muted)]" onClick={() => setAsking(null)}>Cancel</button>
                    </div>
                  )}
                </li>
              );
            })}
            {shown.length > 200 && <li className="px-5 py-2 text-xs text-[var(--muted)]">and {shown.length - 200} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Sign off a period as reviewed. */
export function SignOffForm({ from, to, openIssues, summary }: { from: string; to: string; openIssues: number; summary: Record<string, number> }) {
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const [notes, setNotes] = useState("");
  const { pending, msg, run } = useRun();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">From
          <input type="date" value={a} onChange={(e) => setA(e.target.value)} className="mt-1 block rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1 text-sm text-[var(--text)]" />
        </label>
        <label className="text-xs text-[var(--muted)]">To
          <input type="date" value={b} onChange={(e) => setB(e.target.value)} className="mt-1 block rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1 text-sm text-[var(--text)]" />
        </label>
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What was checked, anything left to follow up"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 text-sm" />
      {msg?.error && <p className="text-xs text-red-700">{msg.error}</p>}
      {msg?.ok && <p className="text-xs text-emerald-700">{msg.ok}</p>}
      <button type="button" disabled={pending}
        onClick={() => run(() => signOff(a, b, notes, openIssues, summary), () => { setNotes(""); return "Signed off."; })}
        className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
        {pending ? "Saving…" : `Sign off${openIssues ? ` with ${openIssues} still open` : ""}`}
      </button>
    </div>
  );
}

export function RemoveSignOff({ id }: { id: string }) {
  const { pending, msg, run } = useRun();
  return (
    <span>
      <button type="button" disabled={pending} className="text-xs text-[var(--muted)] hover:text-red-700"
        onClick={() => { if (confirm("Remove this sign-off?")) run(() => deleteSignOff(id)); }}>Remove</button>
      {msg?.error && <span className="ml-2 text-xs text-red-700">{msg.error}</span>}
    </span>
  );
}
