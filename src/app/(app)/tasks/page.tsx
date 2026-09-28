import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Stat, Badge, Table, Th, Td, Empty } from "@/components/ui";
import { date, today as todayIso } from "@/lib/format";
import { AddTaskButton, DoneButton } from "./task-controls";

export const dynamic = "force-dynamic";

const DAY = 86400000;

export default async function TasksPage() {
  const supabase = await createClient();
  const [{ data: tasks }, { data: milestones }, { data: projects }, { data: staff }] = await Promise.all([
    supabase.from("project_tasks")
      .select("*, projects(id, code, name), profiles:assignee_id(full_name)")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("milestones")
      .select("*, projects(id, code, name)")
      .order("planned_date", { ascending: true, nullsFirst: false }),
    supabase.from("projects").select("id, code, name, status").is("archived_at", null).order("code", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
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

  // simple 14-day calendar strip
  const days = Array.from({ length: 14 }, (_, i) => new Date(start.getTime() + i * DAY));
  const byDay = new Map<string, { tasks: number; milestones: number }>();
  for (const t of open) {
    if (!t.due_date) continue;
    const k = String(t.due_date).slice(0, 10);
    const r = byDay.get(k) ?? { tasks: 0, milestones: 0 };
    r.tasks += 1; byDay.set(k, r);
  }
  for (const m of milestones ?? []) {
    if (!m.planned_date || m.status === "completed") continue;
    const k = String(m.planned_date).slice(0, 10);
    const r = byDay.get(k) ?? { tasks: 0, milestones: 0 };
    r.milestones += 1; byDay.set(k, r);
  }

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

      <Card className="mb-4">
        <CardHeader title="Next 14 days" subtitle="Tasks and milestones falling due" />
        <div className="flex gap-1.5 overflow-x-auto px-5 py-4">
          {days.map((d) => {
            const k = iso(d);
            const r = byDay.get(k);
            const isToday = k === today;
            // the Maldives weekend is Friday and Saturday
            const weekend = [5, 6].includes(d.getUTCDay());
            return (
              <div key={k}
                className={`min-w-[58px] rounded-lg border p-2 text-center ${
                  isToday ? "border-[var(--brand)] bg-[var(--brand-soft)]" : weekend ? "border-[var(--border)] bg-[var(--bg)]" : "border-[var(--border)]"
                }`}>
                <p className="text-[10px] uppercase text-[var(--muted)]">
                  {new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d)}
                </p>
                <p className="text-sm font-semibold">{d.getUTCDate()}</p>
                <div className="mt-1 flex justify-center gap-1">
                  {r?.tasks ? <span className="rounded bg-[var(--brand)] px-1 text-[10px] font-medium text-white">{r.tasks}</span> : null}
                  {r?.milestones ? <span className="rounded bg-[var(--accent)] px-1 text-[10px] font-medium text-white">{r.milestones}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        <p className="border-t border-[var(--border)] px-5 py-2 text-xs text-[var(--muted)]">
          <span className="inline-block h-2 w-2 rounded-sm bg-[var(--brand)]" /> tasks ·{" "}
          <span className="inline-block h-2 w-2 rounded-sm bg-[var(--accent)]" /> milestones
        </p>
      </Card>

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
