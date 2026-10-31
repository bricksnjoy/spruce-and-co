import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Stat, Badge, Table, Th, Td, Empty } from "@/components/ui";
import { date, today as todayIso } from "@/lib/format";
import { AddTaskButton, DoneButton } from "./task-controls";
import { BID_STATUS_LABEL, OPEN_BID, isoToLocal, when, type BidStatus } from "@/lib/bids";
import { MonthCalendar, type CalendarItem } from "./month-calendar";

export const dynamic = "force-dynamic";

const DAY = 86400000;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: asked } = await searchParams;
  const supabase = await createClient();
  const [{ data: tasks }, { data: milestones }, { data: projects }, { data: staff }, { data: bids }] = await Promise.all([
    supabase.from("project_tasks")
      .select("*, projects(id, code, name), profiles:assignee_id(full_name)")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("milestones")
      .select("*, projects(id, code, name)")
      .order("planned_date", { ascending: true, nullsFirst: false }),
    supabase.from("projects").select("id, code, name, status").is("archived_at", null).order("code", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
    supabase.from("bids").select("id, name, company, status, prebid_meeting_at, prebid_attendance, submission_due_at").in("status", OPEN_BID),
  ]);
  // finished and dropped jobs go to the bottom of the list
  const closed = new Set(["completed", "cancelled"]);
  const projectOptions = [...(projects ?? [])]
    .sort((a, b) => Number(closed.has(a.status)) - Number(closed.has(b.status)))
    .map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }));
  const people = (staff ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email || "—" }));

  const list = tasks ?? [];
  // dates compared as YYYY-MM-DD strings, with "today" taken in Maldives time
  const today = todayIso();
  const start = new Date(`${today}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const weekAhead = iso(new Date(start.getTime() + 7 * DAY));

  const open = list.filter((t) => t.status !== "completed");
  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const dueThisWeek = open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= weekAhead);
  const blocked = open.filter((t) => t.status === "blocked");

  // the month calendar: what falls due on each day
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked ?? "") ? asked! : today.slice(0, 7);
  const byDay = new Map<string, CalendarItem[]>();
  const add = (day: string, item: CalendarItem) => byDay.set(day, [...(byDay.get(day) ?? []), item]);
  for (const t of open) {
    if (!t.due_date) continue;
    const proj = t.projects as unknown as { id: string; code: string } | null;
    add(String(t.due_date).slice(0, 10), { kind: "task", label: proj ? `${proj.code} · ${t.title}` : t.title, href: proj ? `/projects/${proj.id}` : null });
  }
  for (const m of milestones ?? []) {
    if (!m.planned_date || m.status === "completed") continue;
    const proj = m.projects as unknown as { id: string; code: string } | null;
    add(String(m.planned_date).slice(0, 10), { kind: "milestone", label: proj ? `${proj.code} · ${m.name}` : m.name, href: proj ? `/projects/${proj.id}` : null });
  }
  // open bids' pre-bid meetings and submission deadlines, on the Maldives date they fall on
  const allBidDates = (bids ?? []).flatMap((b) => [
    b.prebid_meeting_at && { id: b.id, name: b.name, company: b.company, status: b.status as BidStatus, at: b.prebid_meeting_at as string,
      what: `Pre-bid meeting${b.prebid_attendance ? ` (${b.prebid_attendance})` : ""}`, compulsory: b.prebid_attendance === "compulsory" },
    b.submission_due_at && { id: b.id, name: b.name, company: b.company, status: b.status as BidStatus, at: b.submission_due_at as string,
      what: "Submission deadline", compulsory: true },
  ].filter((x): x is NonNullable<typeof x> => Boolean(x)))
    .sort((a, b) => a.at.localeCompare(b.at));
  for (const d of allBidDates) {
    add(isoToLocal(d.at).slice(0, 10), { kind: "bid", label: `${d.what === "Submission deadline" ? "Submission" : "Pre-bid"} · ${d.name}`, href: `/bids/${d.id}` });
  }
  const bidDates = allBidDates.filter((d) => isoToLocal(d.at).slice(0, 10) >= today);

  return (
    <div>
      <PageHeader title="Tasks & calendar" subtitle="What's due across every project"
        action={<AddTaskButton projects={projectOptions} people={people} />} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open tasks" value={String(open.length)} hint={`${list.length} total`} />
        <Stat label="Overdue" value={String(overdue.length)} tone={overdue.length ? "bad" : "good"} />
        <Stat label="Due this week" value={String(dueThisWeek.length)} tone={dueThisWeek.length ? "warn" : "default"} />
        <Stat label="Blocked" value={String(blocked.length)} tone={blocked.length ? "bad" : "default"} />
      </div>

      <Card className="mb-4 overflow-hidden">
        <CardHeader title="Calendar" subtitle="Tasks, milestones and bid dates, month by month" />
        <MonthCalendar month={month} today={today} items={byDay} />
        <p className="px-5 py-2 text-xs text-[var(--muted)]">
          <span className="inline-block h-2 w-2 rounded-sm bg-[var(--brand)]" /> tasks ·{" "}
          <span className="inline-block h-2 w-2 rounded-sm bg-[var(--accent)]" /> milestones ·{" "}
          <span className="inline-block h-2 w-2 rounded-sm bg-amber-500" /> bid dates
        </p>
      </Card>

      {bidDates.length > 0 && (
        <Card className="mb-4">
          <CardHeader title="Bid dates" subtitle="Pre-bid meetings and submission deadlines of open bids"
            action={<Link href="/bids" className="text-xs font-medium text-[var(--brand)] hover:underline">Bids →</Link>} />
          <Table>
            <thead><tr><Th>When</Th><Th>What</Th><Th>Bid</Th><Th>Stage</Th></tr></thead>
            <tbody>
              {bidDates.map((d) => (
                <tr key={`${d.id}-${d.what}`} className="row-link hover:bg-[var(--hover)]">
                  <Td className="whitespace-nowrap text-xs">{when(d.at)}</Td>
                  <Td className={`text-xs ${d.compulsory ? "font-medium" : ""}`}>{d.what}</Td>
                  <Td>
                    <Link href={`/bids/${d.id}`} className="row-link-main font-medium hover:text-[var(--brand)] hover:underline">{d.name}</Link>
                    {d.company && <span className="block text-xs text-[var(--muted)]">{d.company}</span>}
                  </Td>
                  <Td className="text-xs">{BID_STATUS_LABEL[d.status as BidStatus]}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card>
        <CardHeader title="All open tasks" />
        {open.length === 0 ? <Empty message="Nothing outstanding. Use “Add task” to add one." /> : (
          <Table>
            <thead><tr>
              <Th>Task</Th><Th>Project</Th><Th>Assignee</Th><Th>Status</Th><Th right>Due</Th><Th right>{""}</Th>
            </tr></thead>
            <tbody>
              {open.map((t) => {
                const proj = t.projects as unknown as { id: string; code: string; name: string } | null;
                const a = t.profiles as unknown as { full_name: string } | null;
                const late = t.due_date && t.due_date < today;
                return (
                  <tr key={t.id} className="hover:bg-[var(--hover)]">
                    <Td>
                      <span className="font-medium">{t.title}</span>
                      {t.description && <span className="block text-xs text-[var(--muted)]">{t.description}</span>}
                    </Td>
                    <Td>{proj ? <Link href={`/projects/${proj.id}`} className="text-xs hover:underline">{proj.code}</Link> : "—"}</Td>
                    <Td className="text-xs text-[var(--muted)]">{a?.full_name ?? "Unassigned"}</Td>
                    <Td><Badge value={t.status} /></Td>
                    <Td right className={`text-xs ${late ? "font-medium text-red-700" : ""}`}>{date(t.due_date)}</Td>
                    <Td right><DoneButton id={t.id} /></Td>
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
