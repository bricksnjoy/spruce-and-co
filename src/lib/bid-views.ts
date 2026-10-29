/**
 * What the Telegram group sees of the bids beyond each change: every bid at a
 * stage, the bid dates on a calendar and as a list, and the evening reminder.
 * Telegram HTML; dates in Maldives time.
 */
import { tg, type Keyboard } from "./telegram";
import { BID_STATUSES, BID_STATUS_LABEL, type Bid, type BidStatus } from "./bids";

export type BoardBid = Pick<Bid, "id" | "name" | "company" | "location" | "gazette_url" | "status" | "prebid_meeting_at" | "prebid_attendance" | "papers_due_on" | "submission_due_at">;
export type BidView = "cal" | "list" | "stage" | "help";

/** The buttons under a view: each switches the message to another view. */
export const VIEW_KEYS: Keyboard = [[["📅 Calendar", "v:cal"], ["📋 List", "v:list"], ["📊 By stage", "v:stage"]]];
/** The bot's commands in the group, as Telegram's menu lists them. */
export const BOT_COMMANDS: [string, string][] = [
  ["bids", "Every bid, by stage"], ["calendar", "Bid dates on a calendar"], ["list", "Upcoming bid dates as a list"], ["help", "What the bot does"],
];
export const COMMAND_VIEW: Record<string, BidView> = { bids: "stage", stages: "stage", calendar: "cal", list: "list", help: "help", start: "help" };

/** Not yet submitted: its pre-bid meeting and deadline still call for something to be done. */
const TO_SUBMIT: BidStatus[] = ["registered", "prebid_meeting", "papers_ready"];
const OPEN: BidStatus[] = ["registered", "prebid_meeting", "papers_ready", "submitted"];
const TZ = "Indian/Maldives";
const AHEAD = 60;

const dayOf = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const timeOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
/** "Tue 3 Nov" for a yyyy-mm-dd day. */
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00Z`)).replace(",", "");
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const who = (b: BoardBid) => `<b>${tg(b.name)}</b>${b.company ? ` (${tg(b.company)})` : ""}`;

export type BidEvent = { day: string; time: string; at: string; kind: "prebid" | "due"; bid: BoardBid };

/** The pre-bid meetings and deadlines of bids not yet submitted, in date order. */
export function bidEvents(bids: BoardBid[]): BidEvent[] {
  const out: BidEvent[] = [];
  for (const b of bids) {
    if (!TO_SUBMIT.includes(b.status)) continue;
    if (b.prebid_meeting_at) out.push({ day: dayOf(b.prebid_meeting_at), time: timeOf(b.prebid_meeting_at), at: b.prebid_meeting_at, kind: "prebid", bid: b });
    if (b.submission_due_at) out.push({ day: dayOf(b.submission_due_at), time: timeOf(b.submission_due_at), at: b.submission_due_at, kind: "due", bid: b });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.bid.name.localeCompare(b.bid.name));
}

const what = (e: BidEvent) => e.kind === "prebid"
  ? `🤝 Pre-bid meeting${e.bid.prebid_attendance ? ` (${e.bid.prebid_attendance})` : ""}`
  : "⏳ Submission due";
const eventLine = (e: BidEvent, withDay = false) => `• ${withDay ? `${dayLabel(e.day)} ` : ""}${e.time} · ${what(e)} — ${who(e.bid)}`;

/** Keep a message under Telegram's 4,096 characters, cutting between lines. */
function fit(parts: string[], max = 3900): string {
  let out = "";
  for (const p of parts) {
    const next = out ? `${out}\n${p}` : p;
    if (next.length > max) return `${out}\n…and more in the back office.`;
    out = next;
  }
  return out;
}

/** The bids at one stage, the one just moved in bold first. */
export function stageLines(bids: BoardBid[], status: BidStatus, highlight?: string, cap = 15): string[] {
  const at = bids.filter((b) => b.status === status)
    .sort((a, b) => (a.id === highlight ? -1 : b.id === highlight ? 1 : (a.submission_due_at ?? "~").localeCompare(b.submission_due_at ?? "~")));
  const lines = at.slice(0, cap).map((b) => {
    const name = b.id === highlight ? `<b>${tg(b.name)}</b>` : tg(b.name);
    const due = b.submission_due_at && TO_SUBMIT.includes(b.status) ? ` · due ${dayLabel(dayOf(b.submission_due_at))} ${timeOf(b.submission_due_at)}` : "";
    return `• ${name}${b.company ? ` — ${tg(b.company)}` : ""}${due}`;
  });
  if (at.length > cap) lines.push(`…and ${at.length - cap} more`);
  return lines;
}

/** Under a change: every bid now at the same stage. */
export function stagePeers(bids: BoardBid[], status: BidStatus, highlight?: string): string {
  const n = bids.filter((b) => b.status === status).length;
  return [`\n<b>All bids at ${BID_STATUS_LABEL[status]} (${n}):</b>`, ...stageLines(bids, status, highlight)].join("\n");
}

/** Every bid, stage by stage. */
export function stageView(bids: BoardBid[]): string {
  const parts = ["📊 <b>Bids by stage</b>"];
  for (const st of BID_STATUSES) {
    const n = bids.filter((b) => b.status === st).length;
    if (n) parts.push(`\n<b>${BID_STATUS_LABEL[st]}</b> (${n})`, ...stageLines(bids, st, undefined, st === "won" || st === "lost" ? 10 : 15));
  }
  if (parts.length === 1) parts.push("No bids yet.");
  return fit(parts);
}

/** A month as a calendar, Monday first: [d] has a bid date, (d) is today. */
export function monthGrid(month: string, marked: Set<string>, today: string): string {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: string[] = Array((first.getUTCDay() + 6) % 7).fill("    ");
  for (let d = 1; d <= days; d++) {
    const key = `${month}-${String(d).padStart(2, "0")}`;
    cells.push(marked.has(key) ? `[${d}]`.padStart(4) : key === today ? `(${d})`.padStart(4) : ` ${String(d).padStart(2)} `);
  }
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).join("").trimEnd());
  const title = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(first);
  return [title, " Mo  Tu  We  Th  Fr  Sa  Su", ...rows].join("\n");
}

/** This month, and the months after it that have bid dates in the next 60 days. */
function grids(events: BidEvent[], today: string): string {
  const marked = new Set(events.map((e) => e.day));
  const months = [...new Set([today.slice(0, 7), ...events.map((e) => e.day.slice(0, 7))])].sort().slice(0, 3);
  return `<pre>${months.map((mo) => monthGrid(mo, marked, today)).join("\n\n")}</pre>`;
}

const upcoming = (bids: BoardBid[], today: string) => bidEvents(bids).filter((e) => e.day >= today && e.day <= addDays(today, AHEAD));

/** The bid dates on a calendar, each marked day listed under it. */
export function calendarView(bids: BoardBid[], now: Date): string {
  const today = dayOf(now.toISOString());
  const events = upcoming(bids, today);
  const parts = ["📅 <b>Bid calendar</b>", grids(events, today), "[d] a bid date · (d) today"];
  if (!events.length) parts.push(`\nNo bid dates in the next ${AHEAD} days.`);
  else parts.push("", ...events.map((e) => eventLine(e, true)));
  return fit(parts);
}

/** Bids whose deadline has passed without being submitted. */
function passed(bids: BoardBid[], now: Date): string[] {
  return bids.filter((b) => TO_SUBMIT.includes(b.status) && b.submission_due_at && b.submission_due_at < now.toISOString())
    .map((b) => `• ${who(b)} — was due ${dayLabel(dayOf(b.submission_due_at!))} ${timeOf(b.submission_due_at!)}`);
}

/** The bid dates as a list, day by day. */
export function listView(bids: BoardBid[], now: Date): string {
  const today = dayOf(now.toISOString());
  const events = upcoming(bids, today);
  const parts = ["📋 <b>Upcoming bid dates</b>"];
  const late = passed(bids, now);
  if (late.length) parts.push("\n⚠️ <b>Deadline passed, not submitted</b>", ...late);
  let day = "";
  for (const e of events) {
    if (e.day !== day) {
      day = e.day;
      const tag = day === today ? " · today" : day === addDays(today, 1) ? " · tomorrow" : "";
      parts.push(`\n<b>${dayLabel(day)}</b>${tag}`);
    }
    parts.push(eventLine(e));
  }
  if (!events.length) parts.push(`\nNo bid dates in the next ${AHEAD} days.`);
  const undated = bids.filter((b) => TO_SUBMIT.includes(b.status) && !b.prebid_meeting_at && !b.submission_due_at).length;
  if (undated) parts.push(`\n<i>${undated} open bid${undated === 1 ? " has" : "s have"} no dates yet.</i>`);
  return fit(parts);
}

/** "Mon, 2 Nov" for a yyyy-mm-dd day. */
export function shortDay(day: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .formatToParts(new Date(`${day}T00:00:00Z`)).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} ${p.month}`;
}
/** "Wed, 4 Nov, 10:30" in Maldives time. */
const dayTime = (iso: string) => `${shortDay(dayOf(iso))}, ${timeOf(iso)}`;

/** When the papers should be ready: the date set, or two days before the deadline. */
export function papersDue(b: Pick<BoardBid, "papers_due_on" | "submission_due_at">): string | null {
  return b.papers_due_on ?? (b.submission_due_at ? addDays(dayOf(b.submission_due_at), -2) : null);
}

/**
 * How far a day is from today: in 4 days, in 2 days, tomorrow, TODAY, overdue by
 * 1 day; a time already passed today is overdue.
 */
export function fromToday(today: string, day: string, passed = false): string {
  const n = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);
  if (n < 0) return `<b>overdue by ${-n} day${n === -1 ? "" : "s"}</b>`;
  if (n === 0) return passed ? "<b>overdue</b>" : "<b>TODAY</b>";
  return n === 1 ? "tomorrow" : `in ${n} days`;
}

const TO_PREPARE: BidStatus[] = ["registered", "prebid_meeting"];
const bullet = (b: BoardBid) => `• ${tg(b.name)}${b.company ? ` – ${tg(b.company)}` : ""}`;
const byDate = (k: (b: BoardBid) => string | null) => (a: BoardBid, b: BoardBid) => (k(a) ?? "~").localeCompare(k(b) ?? "~") || a.name.localeCompare(b.name);

/**
 * The evening reminder (8 PM): tomorrow's pre-bid meetings (when there are
 * any), the bids still preparing papers with their papers-ready and submission
 * dates counted down, the bids with papers ready awaiting submission, and how
 * many bids are open. Nothing when no bid is being prepared or awaiting submission.
 */
export function dailyDigest(bids: BoardBid[], now: Date): string | null {
  const today = dayOf(now.toISOString());
  const preparing = bids.filter((b) => TO_PREPARE.includes(b.status)).sort(byDate((b) => papersDue(b)));
  const ready = bids.filter((b) => b.status === "papers_ready").sort(byDate((b) => b.submission_due_at));
  const meetings = (day: string) => bids.filter((b) => TO_SUBMIT.includes(b.status) && b.prebid_meeting_at && dayOf(b.prebid_meeting_at) === day)
    .sort(byDate((b) => b.prebid_meeting_at));
  const meetTomorrow = meetings(addDays(today, 1));
  if (!preparing.length && !ready.length && !meetTomorrow.length) return null;

  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short", year: "numeric" })
    .formatToParts(new Date(`${today}T00:00:00Z`)).map((x) => [x.type, x.value]));
  const parts = [`<b>Bid Reminder – ${p.day} ${p.month} ${p.year} ${p.weekday}</b>`];
  const submission = (b: BoardBid) => (b.submission_due_at
    ? [`Submission: ${dayTime(b.submission_due_at)} (${fromToday(today, dayOf(b.submission_due_at), b.submission_due_at < now.toISOString())})`] : []);
  const meetingSection = (title: string, list: BoardBid[]) => {
    if (!list.length) return;
    parts.push("", `<b>${title}</b>`);
    for (const b of list) {
      const where = [b.company, b.location].filter(Boolean).map((x) => tg(x!)).join(", ");
      parts.push(bullet(b), `${dayTime(b.prebid_meeting_at!)}${where ? ` · ${where}` : ""}`);
    }
  };
  meetingSection("Pre-bid meetings tomorrow", meetTomorrow);

  parts.push("", "<b>Registered – papers to prepare</b>");
  if (!preparing.length) parts.push("• None");
  for (const b of preparing) {
    const due = papersDue(b);
    parts.push(bullet(b), ...(due ? [`Papers ready by: ${shortDay(due)} (${fromToday(today, due)})`] : []), ...submission(b));
  }
  parts.push("", "<b>Papers ready – awaiting submission</b>");
  if (!ready.length) parts.push("• None");
  for (const b of ready) parts.push(bullet(b), ...submission(b));

  parts.push("", `📊 Open bids: ${bids.filter((b) => OPEN.includes(b.status)).length}`);
  return fit(parts);
}

export const HELP = [
  "🤖 <b>Spruce &amp; Co bids</b>",
  "Each new bid and each change of stage is posted here, with every bid at that stage.",
  "Every evening at 8 PM: tomorrow's pre-bid meetings, the papers to prepare and the bids awaiting submission, counted down.",
  "",
  "/bids — every bid, by stage",
  "/calendar — bid dates on a calendar",
  "/list — upcoming bid dates as a list",
].join("\n");

export function renderView(view: BidView, bids: BoardBid[], now: Date): string {
  return view === "cal" ? calendarView(bids, now) : view === "list" ? listView(bids, now) : view === "stage" ? stageView(bids) : HELP;
}
