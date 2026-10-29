/** Bids (tenders): their stages, and what is posted to the Telegram group about them. */
import { tg } from "./telegram";

export const BID_STATUSES = ["registered", "prebid_meeting", "papers_ready", "submitted", "won", "lost"] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const BID_STATUS_LABEL: Record<BidStatus, string> = {
  registered: "Registered",
  prebid_meeting: "Pre-bid meeting",
  papers_ready: "Papers ready",
  submitted: "Bid submitted",
  won: "Bid won",
  lost: "Bid lost",
};
export const BID_STATUS_TONE: Record<BidStatus, string> = {
  registered: "bg-slate-100 text-slate-700",
  prebid_meeting: "bg-sky-100 text-sky-800",
  papers_ready: "bg-violet-100 text-violet-800",
  submitted: "bg-amber-100 text-amber-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-red-100 text-red-700",
};
export const isBidStatus = (s: unknown): s is BidStatus => BID_STATUSES.includes(s as BidStatus);
export const OPEN_BID: BidStatus[] = ["registered", "prebid_meeting", "papers_ready", "submitted"];

export type Bid = {
  id: string; name: string; company: string | null; location: string | null; gazette_url: string | null; status: BidStatus;
  prebid_meeting_at: string | null; prebid_attendance: "optional" | "compulsory" | null;
  submission_due_at: string | null; notes: string | null; project_id: string | null;
};

const MVT = "+05:00";
/** A date and time typed in the Maldives ("2026-11-03T10:00") as a timestamp; null if blank or not one. */
export function localToIso(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return null;
  const d = new Date(`${s}:00${MVT}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** A timestamp as the Maldives date and time a datetime-local field shows. */
export function isoToLocal(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(new Date(v).getTime() + 5 * 3600_000);
  return d.toISOString().slice(0, 16);
}
/** "Tue, 3 Nov 2026, 10:00" in Maldives time. */
export function when(v: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Indian/Maldives",
  }).format(new Date(v));
}

/** "4th November 2026 10:30" in Maldives time, as the group reads it. */
export function longWhen(v: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Indian/Maldives",
  }).formatToParts(new Date(v)).map((x) => [x.type, x.value]));
  const d = Number(p.day);
  const th = d % 100 >= 11 && d % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][d % 10] ?? "th";
  return `${d}${th} ${p.month} ${p.year} ${p.hour}:${p.minute}`;
}

const attr = (s: string) => tg(s).replace(/"/g, "&quot;");

/**
 * What the group is told when a bid is added, its stage moves, or its dates change:
 * the stage in bold, then the bid's name, pre-bid meeting (when there is one),
 * submission date, location and Gazette notice.
 */
export function bidMessage(kind: "added" | "status" | "dates", b: Bid, opts: { note?: string | null } = {}): string {
  const head = kind === "added" ? "New bid" : kind === "dates" ? "Bid dates changed" : "Bid Status update";
  const lines = [
    `<b>${head} - ${BID_STATUS_LABEL[b.status]}</b>`,
    "",
    `Bid Name: ${tg(b.name)}${b.company ? ` by ${tg(b.company)}` : ""}`,
  ];
  if (b.prebid_meeting_at) lines.push(`Pre-bid meeting: ${longWhen(b.prebid_meeting_at)}${b.prebid_attendance ? ` (${b.prebid_attendance})` : ""}`);
  lines.push(
    `Bid submission date: ${b.submission_due_at ? `<b>${longWhen(b.submission_due_at)}</b>` : "—"}`,
    `Location: ${b.location ? tg(b.location) : "—"}`,
    `Gazette Notice: ${b.gazette_url ? `<a href="${attr(b.gazette_url)}">${tg(b.gazette_url)}</a>` : "—"}`,
  );
  if (opts.note) lines.push("", `Note: ${tg(opts.note)}`);
  return lines.join("\n");
}
