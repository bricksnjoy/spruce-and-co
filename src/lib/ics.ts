/**
 * A calendar feed (iCalendar, .ics) that Google Calendar, Apple Calendar or
 * Outlook subscribes to: the bids' pre-bid meetings, papers-ready days and
 * submission deadlines, the projects' task due dates and milestones.
 */
import { OPEN_BID, BID_STATUS_LABEL, type BidStatus } from "./bids";
import { papersDue, type BoardBid } from "./bid-views";

export type CalItem = { kind: "task" | "milestone"; id: string; title: string; day: string; project: string | null };
export type CalEvent = { uid: string; title: string; detail?: string; url?: string } & ({ at: string; minutes: number } | { day: string });

/** Text as iCalendar wants it: backslashes, commas, semicolons and line breaks escaped. */
export const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Lines are folded at 75 bytes, the rest starting with a space. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dayStamp = (day: string) => day.replace(/-/g, "");
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);

/** Each open bid's dates, and each open task and milestone, as calendar events. */
export function calendarEvents(bids: BoardBid[], items: CalItem[], site: string): CalEvent[] {
  const ev: CalEvent[] = [];
  for (const b of bids.filter((x) => OPEN_BID.includes(x.status as BidStatus))) {
    const name = `${b.name}${b.company ? ` (${b.company})` : ""}`;
    const detail = [`Stage: ${BID_STATUS_LABEL[b.status as BidStatus] ?? b.status}`, b.location && `Location: ${b.location}`, b.gazette_url && `Gazette: ${b.gazette_url}`]
      .filter(Boolean).join("\n");
    const url = `${site}/bids/${b.id}`;
    if (b.prebid_meeting_at) ev.push({ uid: `prebid-${b.id}`, title: `Pre-bid meeting${b.prebid_attendance === "compulsory" ? " (compulsory)" : ""}: ${name}`, at: b.prebid_meeting_at, minutes: 60, detail, url });
    if (b.submission_due_at) ev.push({ uid: `submit-${b.id}`, title: `Bid submission: ${name}`, at: b.submission_due_at, minutes: 30, detail, url });
    const papers = ["posted", "registered", "prebid_meeting"].includes(b.status) ? papersDue(b) : null;
    if (papers) ev.push({ uid: `papers-${b.id}`, title: `Bid papers ready: ${name}`, day: papers, detail, url });
  }
  for (const i of items) {
    ev.push({ uid: `${i.kind}-${i.id}`, title: `${i.kind === "task" ? "Task" : "Milestone"}: ${i.title}${i.project ? ` · ${i.project}` : ""}`, day: i.day, url: `${site}/tasks` });
  }
  return ev;
}

/** The whole feed. */
export function icsFeed(events: CalEvent[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Spruce & Co//Back Office//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Spruce & Co", "X-WR-TIMEZONE:Indian/Maldives", "X-WR-CALDESC:Bids\\, project tasks and milestones from the Spruce & Co back office",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  const dtstamp = stamp(now.toISOString());
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@spruceandco.org`, `DTSTAMP:${dtstamp}`);
    if ("at" in e) {
      const end = new Date(Date.parse(e.at) + e.minutes * 60_000).toISOString();
      lines.push(`DTSTART:${stamp(new Date(e.at).toISOString())}`, `DTEND:${stamp(end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dayStamp(e.day)}`, `DTEND;VALUE=DATE:${dayStamp(nextDay(e.day))}`);
    }
    lines.push(`SUMMARY:${icsText(e.title)}`);
    if (e.detail) lines.push(`DESCRIPTION:${icsText(e.detail)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
