import { describe, expect, it } from "vitest";
import { bidEvents, calendarView, dailyDigest, listView, monthGrid, stagePeers, stageView, type BoardBid } from "@/lib/bid-views";

// Thursday 29 October 2026, 08:00 in the Maldives
const NOW = new Date("2026-10-29T03:00:00Z");
const bid = (x: Partial<BoardBid> & { id: string; name: string }): BoardBid => ({
  company: null, gazette_url: null, status: "registered", prebid_meeting_at: null, prebid_attendance: null, submission_due_at: null, ...x,
});
const BIDS: BoardBid[] = [
  bid({ id: "a", name: "School hall <Th.>", company: "Ministry of Education", prebid_meeting_at: "2026-10-29T05:00:00Z", prebid_attendance: "compulsory", submission_due_at: "2026-11-20T08:30:00Z" }),
  bid({ id: "b", name: "Jetty", status: "papers_ready", submission_due_at: "2026-10-30T09:00:00Z" }),
  bid({ id: "c", name: "Road", status: "prebid_meeting", submission_due_at: "2026-10-27T09:00:00Z" }),
  bid({ id: "d", name: "Clinic", status: "submitted", submission_due_at: "2026-10-31T09:00:00Z" }),
  bid({ id: "e", name: "Office", status: "won" }),
  bid({ id: "f", name: "Mosque", status: "registered" }),
];

describe("what the Telegram group sees of the bids", () => {
  it("only reminds of dates for bids not yet submitted, in Maldives time", () => {
    expect(bidEvents(BIDS).map((e) => `${e.day} ${e.time} ${e.kind} ${e.bid.id}`)).toEqual([
      "2026-10-27 14:00 due c", "2026-10-29 10:00 prebid a", "2026-10-30 14:00 due b", "2026-11-20 13:30 due a",
    ]);
  });

  it("lists every bid at the stage a bid moved to, that one first in bold", () => {
    const m = stagePeers(BIDS, "registered", "f");
    expect(m).toContain("<b>All bids at Registered (2):</b>");
    expect(m.split("\n").slice(2)).toEqual(["• <b>Mosque</b>", "• School hall &lt;Th.&gt; — Ministry of Education · due Fri 20 Nov 13:30"]);
  });

  it("shows every bid stage by stage", () => {
    const v = stageView(BIDS);
    expect(v).toMatch(/^📊 <b>Bids by stage<\/b>/);
    for (const s of ["<b>Registered</b> (2)", "<b>Pre-bid meeting</b> (1)", "<b>Papers ready</b> (1)", "<b>Bid submitted</b> (1)", "<b>Bid won</b> (1)"]) expect(v).toContain(s);
    expect(v).not.toContain("Bid lost");
  });

  it("draws a month Monday first, marking bid dates and today", () => {
    expect(monthGrid("2026-11", new Set(["2026-11-20", "2026-11-03"]), "2026-11-02")).toBe([
      "November 2026",
      " Mo  Tu  We  Th  Fr  Sa  Su",
      "                          1",
      " (2) [3]  4   5   6   7   8",
      "  9  10  11  12  13  14  15",
      " 16  17  18  19 [20] 21  22",
      " 23  24  25  26  27  28  29",
      " 30",
    ].join("\n"));
  });

  it("gives the calendar for this month and the next with dates, and the dates listed under it", () => {
    const v = calendarView(BIDS, NOW);
    expect(v).toContain("<pre>October 2026");
    expect(v).toContain("November 2026");
    expect(v).toContain("[29][30]");
    expect(v).toContain("• Thu 29 Oct 10:00 · 🤝 Pre-bid meeting (compulsory) — <b>School hall &lt;Th.&gt;</b> (Ministry of Education)");
    expect(v).toContain("• Fri 20 Nov 13:30 · ⏳ Submission due — <b>School hall &lt;Th.&gt;</b> (Ministry of Education)");
    expect(v).not.toContain("Clinic"); // submitted already
  });

  it("lists the dates day by day, with deadlines passed and bids with no dates", () => {
    const v = listView(BIDS, NOW);
    expect(v).toContain("⚠️ <b>Deadline passed, not submitted</b>\n• <b>Road</b> — was due Tue 27 Oct 14:00");
    expect(v).toContain("<b>Thu 29 Oct</b> · today\n• 10:00 · 🤝 Pre-bid meeting (compulsory)");
    expect(v).toContain("<b>Fri 30 Oct</b> · tomorrow\n• 14:00 · ⏳ Submission due — <b>Jetty</b>");
    expect(v).toContain("1 open bid has no dates yet.");
  });

  it("reminds each morning of today, tomorrow and the week, and keeps quiet when the week is clear", () => {
    const d = dailyDigest(BIDS, NOW)!;
    expect(d).toMatch(/^⏰ <b>Bid reminders<\/b> · Thu 29 Oct/);
    expect(d).toContain("<b>Today</b>\n• 10:00 · 🤝 Pre-bid meeting");
    expect(d).toContain("<b>Tomorrow</b>\n• 14:00 · ⏳ Submission due — <b>Jetty</b>");
    expect(d).toContain("<pre>October 2026");
    expect(dailyDigest([BIDS[4], BIDS[5]], NOW)).toBeNull();
    expect(dailyDigest([bid({ id: "z", name: "Far", submission_due_at: "2026-12-20T08:00:00Z" })], NOW)).toBeNull();
  });

  it("stays under Telegram's size limit however many bids there are", () => {
    const many = Array.from({ length: 200 }, (_, i) => bid({ id: `m${i}`, name: `Bid number ${i} with a long name for the island`, submission_due_at: "2026-11-05T05:00:00Z" }));
    for (const v of [stageView(many), calendarView(many, NOW), listView(many, NOW), dailyDigest(many, NOW)!]) {
      expect(v.length).toBeLessThan(4096);
      expect(v.match(/<pre>/g)?.length ?? 0).toBe(v.match(/<\/pre>/g)?.length ?? 0);
    }
  });
});
