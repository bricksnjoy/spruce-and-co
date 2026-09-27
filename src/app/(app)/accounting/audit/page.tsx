import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { date, dateTime, money, today as todayMv } from "@/lib/format";
import { loadRecords } from "@/lib/accounting";
import { runChecks, SEVERITY_ORDER } from "@/lib/audit-checks";
import { AccountingTabs } from "../nav";
import { CheckCard, RemoveSignOff, SignOffForm, type Mark } from "./audit-client";

export const dynamic = "force-dynamic";

const TABLES: Record<string, string> = {
  bills: "Bill",
  invoices: "Invoice",
  invoice_items: "Invoice line",
  quotations: "Quotation",
  capital_pool_entries: "Capital pool",
  internal_account_entries: "Profit share",
  salary_payments: "Salary",
  investor_repayments: "Investor repayment",
  projects: "Project",
  variations: "Variation",
  project_financing_sources: "Financing",
  vendors: "Supplier",
  clients: "Client",
};

/** A short name for a changed record, from whichever of its fields says what it is. */
function recordName(d: Record<string, unknown> | null) {
  if (!d) return "";
  for (const k of ["number", "bill_no", "code", "ref", "name", "title", "share_name", "note", "description"]) {
    if (d[k]) return String(d[k]).slice(0, 60);
  }
  return String(d.id ?? "").slice(0, 8);
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40));

/** A week's worth of bills picked at random, the same all week, to check against their receipts. */
function weeklySample<T extends { id: string }>(items: T[], size: number, today: string) {
  const d = new Date(`${today}T00:00:00Z`);
  const week = Math.floor(d.getTime() / (7 * 86_400_000));
  let seed = week;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  return [...items].map((x) => ({ x, k: rand() })).sort((a, b) => a.k - b.k).slice(0, size).map((v) => v.x);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ log?: string; deleted?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  let log = supabase.from("audit_log").select("*").order("at", { ascending: false }).limit(100);
  if (sp.log && TABLES[sp.log]) log = log.eq("table_name", sp.log);
  if (sp.deleted === "1") log = log.eq("action", "delete");
  const [records, { data: vendors }, { data: marks }, { data: changes }, { data: people }, { data: reviews }] = await Promise.all([
    loadRecords(supabase),
    supabase.from("vendors").select("id, name"),
    supabase.from("audit_marks").select("check_key, record_id, status, note, marked_by, marked_at"),
    log,
    supabase.from("profiles").select("id, full_name, email"),
    supabase.from("audit_reviews").select("*").order("period_end", { ascending: false }),
  ]);
  const who = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email || "someone"]));
  const today = todayMv();

  const checks = runChecks(records, vendors ?? []).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const markBy = new Map<string, Record<string, Mark>>();
  for (const m of marks ?? []) {
    const rec = markBy.get(m.check_key) ?? {};
    rec[m.record_id] = { status: m.status, note: m.note, by: m.marked_by ? who.get(m.marked_by) ?? null : null, at: m.marked_at };
    markBy.set(m.check_key, rec);
  }
  const openOf = (key: string, ids: string[]) => ids.filter((id) => markBy.get(key)?.[id]?.status !== "ok").length;
  const open = checks.reduce((s, c) => s + openOf(c.key, c.items.map((i) => i.id)), 0);
  const high = checks.filter((c) => c.severity === "high").reduce((s, c) => s + openOf(c.key, c.items.map((i) => i.id)), 0);
  const accepted = (marks ?? []).filter((m) => m.status === "ok").length;
  const queried = (marks ?? []).filter((m) => m.status === "query").length;
  const clear = checks.filter((c) => openOf(c.key, c.items.map((i) => i.id)) === 0).length;
  const summary = Object.fromEntries(checks.map((c) => [c.key, openOf(c.key, c.items.map((i) => i.id))]));
  const last = reviews?.[0];

  // this week's random sample of bills to tick off against their receipts
  const live = records.bills.filter((b) => b.status !== "void" && b.status !== "draft");
  const sample = weeklySample(live, Math.min(10, live.length), today).map((b) => ({
    id: b.id,
    label: `${(b.vendors as unknown as { name: string } | null)?.name ?? "Unknown supplier"} · ${b.bill_no ? `bill ${b.bill_no}` : "no bill number"} · ${b.issue_date ?? ""}`,
    detail: `${b.description ?? ""}${b.attachment_path ? "" : " · no photo on file"}`.replace(/^ · /, ""),
    amount: Number(b.total),
    href: b.project_id ? `/projects/${b.project_id}` : "/projects",
  }));
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthEnd = new Date(Date.parse(`${monthStart}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="Accounting" subtitle="Check the books the way an auditor would" />
      <AccountingTabs active="/accounting/audit" />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="To look at" value={String(open)} hint={`${high} high priority`} tone={high ? "bad" : open ? "warn" : "good"} />
        <Stat label="Checks clear" value={`${clear} of ${checks.length}`} tone={clear === checks.length ? "good" : "default"} />
        <Stat label="Reviewed" value={String(accepted + queried)} hint={`${accepted} accepted · ${queried} queried`} />
        <Stat label="Last sign-off" value={last ? date(last.period_end) : "Never"} hint={last ? `by ${who.get(last.reviewed_by) ?? "someone"}, ${last.open_issues} open then` : "sign off a period below"} tone={last ? "default" : "warn"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Checks</h2>
          {checks.map((c) => (
            <CheckCard key={c.key} check={c} marks={markBy.get(c.key) ?? {}} startOpen={c.severity === "high" && openOf(c.key, c.items.map((i) => i.id)) > 0} />
          ))}

          <h2 className="pt-3 text-sm font-semibold">This week&apos;s spot check</h2>
          <CheckCard
            check={{
              key: "sample",
              title: `${sample.length} bills picked at random`,
              why: "Find each one's receipt and check the supplier, date and amount match. A new set is picked every week; tick each one you have checked.",
              severity: "medium",
              items: sample,
            }}
            marks={markBy.get("sample") ?? {}}
            startOpen
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Sign off a period" subtitle="Record that the books were checked, and what was still open" />
            <div className="px-5 py-4">
              <SignOffForm from={last ? new Date(Date.parse(`${last.period_end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : `${today.slice(0, 4)}-01-01`}
                to={prevMonthEnd} openIssues={open} summary={summary} />
            </div>
            <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)] text-sm">
              {(reviews ?? []).map((r) => (
                <li key={r.id} className="px-5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{date(r.period_start)} – {date(r.period_end)}</span>
                    <RemoveSignOff id={r.id} />
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    {who.get(r.reviewed_by) ?? "Someone"} · {dateTime(r.reviewed_at)} · {r.open_issues ? `${r.open_issues} open` : "all clear"}
                  </p>
                  {r.notes && <p className="text-xs">{r.notes}</p>}
                </li>
              ))}
              {!reviews?.length && <li className="px-5 py-3 text-xs text-[var(--muted)]">No periods signed off yet.</li>}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Change log" subtitle="Every change to money records, who made it and when — it cannot be edited" />
            <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-5 py-2 text-xs">
              <Link href="/accounting/audit" className={`rounded-full px-2 py-0.5 ${!sp.log && !sp.deleted ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}>All</Link>
              <Link href="/accounting/audit?deleted=1" className={`rounded-full px-2 py-0.5 ${sp.deleted ? "bg-red-700 text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}>Deleted</Link>
              {["bills", "invoices", "projects", "capital_pool_entries", "internal_account_entries", "salary_payments"].map((t) => (
                <Link key={t} href={`/accounting/audit?log=${t}`}
                  className={`rounded-full px-2 py-0.5 ${sp.log === t ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}>
                  {TABLES[t]}
                </Link>
              ))}
            </div>
            <ul className="max-h-[640px] divide-y divide-[var(--border)] overflow-y-auto text-sm">
              {(changes ?? []).map((c) => {
                const data = (c.new_data ?? c.old_data) as Record<string, unknown> | null;
                return (
                  <li key={c.id} className="px-5 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          c.action === "delete" ? "bg-red-50 text-red-800" : c.action === "insert" ? "bg-emerald-50 text-emerald-800" : "bg-blue-50 text-blue-800"
                        }`}>{c.action === "insert" ? "added" : c.action === "delete" ? "deleted" : "changed"}</span>
                        {TABLES[c.table_name] ?? c.table_name} · {recordName(data)}
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--muted)]">{dateTime(c.at)}</span>
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">{c.user_id ? who.get(c.user_id) ?? "someone" : "the system"}</p>
                    {c.action === "update" && c.changed?.length > 0 && (
                      <ul className="mt-0.5 space-y-0.5 text-[11px]">
                        {(c.changed as string[]).slice(0, 4).map((k) => (
                          <li key={k} className="truncate">
                            <span className="text-[var(--muted)]">{k.replace(/_/g, " ")}:</span>{" "}
                            <span className="line-through decoration-red-400">{show((c.old_data as Record<string, unknown>)?.[k])}</span> →{" "}
                            <span>{show((c.new_data as Record<string, unknown>)?.[k])}</span>
                          </li>
                        ))}
                        {c.changed.length > 4 && <li className="text-[var(--muted)]">and {c.changed.length - 4} more</li>}
                      </ul>
                    )}
                    {c.action === "delete" && data?.total !== undefined && <p className="text-[11px] text-red-700">was {money(Number(data.total))}</p>}
                  </li>
                );
              })}
              {!changes?.length && (
                <li className="px-5 py-4 text-xs text-[var(--muted)]">
                  Nothing yet. From now on every added, changed or deleted bill, invoice, payment, project and profit share is recorded here.
                </li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
