import Link from "next/link";

export type CalendarItem = { kind: "task" | "milestone" | "bid"; label: string; href: string | null };

const TONE: Record<CalendarItem["kind"], string> = {
  task: "bg-[var(--brand)]",
  milestone: "bg-[var(--accent)]",
  bid: "bg-amber-500",
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHOWN = 3;

/** 2026-11 plus 1 → 2026-12 */
export function shiftMonth(month: string, by: number) {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

/**
 * One month, Sunday to Saturday as the Maldives week runs: each day lists
 * what falls due on it (open tasks, milestones and bid dates), with arrows
 * to the months either side; the days of the months either side that fill
 * its weeks show their day in grey. On a phone a day shows coloured counts instead.
 */
export function MonthCalendar({ month, today, items }: { month: string; today: string; items: Map<string, CalendarItem[]> }) {
  const first = new Date(`${month}-01T00:00:00Z`);
  // six whole weeks from the Sunday on or before the 1st, so the days either side show too
  const cells = Array.from({ length: 42 }, (_, i) => new Date(first.getTime() + (i - first.getUTCDay()) * 86_400_000).toISOString().slice(0, 10));
  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const arrow = "rounded-md border border-[var(--border)] px-2.5 py-1 text-sm hover:bg-[var(--hover)]";

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="flex items-center gap-1.5">
          <Link href={`/tasks?month=${shiftMonth(month, -1)}`} aria-label="Previous month" className={arrow}>‹</Link>
          {month !== today.slice(0, 7) && <Link href="/tasks" className={`${arrow} text-xs`}>This month</Link>}
          <Link href={`/tasks?month=${shiftMonth(month, 1)}`} aria-label="Next month" className={arrow}>›</Link>
        </div>
      </div>
      <div className="grid grid-cols-7 border-t border-[var(--border)] text-xs">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`border-b border-[var(--border)] px-1.5 py-1.5 text-center text-[10px] font-medium uppercase text-[var(--muted)] ${i > 4 ? "bg-[var(--bg)]" : ""}`}>{w}</div>
        ))}
        {cells.map((day, i) => {
          const list = items.get(day) ?? [];
          const other = day.slice(0, 7) !== month;
          // the Maldives weekend is Friday and Saturday
          const weekend = i % 7 > 4;
          const count = (k: CalendarItem["kind"]) => list.filter((x) => x.kind === k).length;
          return (
            <div key={day}
              className={`min-h-[64px] border-b border-r border-[var(--border)] p-1 sm:min-h-[96px] sm:p-1.5 ${i % 7 === 6 ? "border-r-0" : ""} ${weekend ? "bg-[var(--bg)]" : ""}`}>
              <p className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                day === today ? "bg-[var(--brand)] text-white" : other ? "font-normal text-[var(--muted)] opacity-60" : day < today ? "text-[var(--muted)]" : ""}`}>
                {Number(day.slice(8))}
              </p>
              {/* phones: counts by kind */}
              <div className="flex flex-wrap gap-0.5 sm:hidden">
                {(["task", "milestone", "bid"] as const).map((k) => count(k) > 0 && (
                  <span key={k} className={`rounded px-1 text-[10px] font-medium text-white ${TONE[k]}`}>{count(k)}</span>
                ))}
              </div>
              <ul className="hidden space-y-0.5 sm:block">
                {list.slice(0, SHOWN).map((x, j) => (
                  <li key={j} className="flex items-center gap-1 leading-tight" title={x.label}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[x.kind]}`} />
                    {x.href ? <Link href={x.href} className="truncate hover:underline">{x.label}</Link> : <span className="truncate">{x.label}</span>}
                  </li>
                ))}
                {list.length > SHOWN && <li className="pl-2.5 text-[10px] text-[var(--muted)]">+{list.length - SHOWN} more</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
