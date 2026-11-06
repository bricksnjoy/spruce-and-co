import { describe, expect, it } from "vitest";
import { calendarEvents, fold, icsFeed, icsText } from "@/lib/ics";
import type { BoardBid } from "@/lib/bid-views";

const bid = (x: Partial<BoardBid>): BoardBid => ({
  id: "b1", name: "Call Center", company: "Ministry of Health", location: "Male", gazette_url: "https://www.gazette.gov.mv/iulaan/418055",
  status: "papers_ready", prebid_meeting_at: null, prebid_attendance: null, papers_due_on: null, submission_due_at: null, ...x,
});

describe("the calendar feed", () => {
  it("has each open bid's meeting and deadline at their times, and tasks and milestones on their days", () => {
    const ev = calendarEvents([
      bid({ status: "registered", prebid_meeting_at: "2026-11-10T05:00:00.000Z", prebid_attendance: "compulsory", submission_due_at: "2026-11-20T05:30:00.000Z" }),
      bid({ id: "b2", status: "lost", submission_due_at: "2026-11-21T05:00:00.000Z" }),
    ], [{ kind: "task", id: "t1", title: "Order tiles", day: "2026-11-12", project: "SC-003 · youth" }], "https://spruceandco.org");
    expect(ev.map((e) => e.uid)).toEqual(["prebid-b1", "submit-b1", "papers-b1", "task-t1"]);
    const ics = icsFeed(ev, new Date("2026-11-06T00:00:00Z"));
    expect(ics).toContain("SUMMARY:Pre-bid meeting (compulsory): Call Center (Ministry of Health)");
    expect(ics).toContain("DTSTART:20261110T050000Z\r\nDTEND:20261110T060000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261118\r\nDTEND;VALUE=DATE:20261119"); // papers ready: 2 days before the deadline
    expect(ics).toContain("SUMMARY:Task: Order tiles · SC-003 · youth");
    expect(ics).not.toContain("b2");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes text and folds long lines", () => {
    expect(icsText("a, b; c\\d\ne")).toBe("a\\, b\; c\\\\d\\ne");
    const f = fold(`SUMMARY:${"x".repeat(200)}`);
    expect(f.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(f.replace(/\r\n /g, "")).toBe(`SUMMARY:${"x".repeat(200)}`);
  });
});
