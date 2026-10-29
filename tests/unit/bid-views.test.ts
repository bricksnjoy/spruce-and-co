import { describe, expect, it } from "vitest";
import { bidEvents, calendarView, dailyDigest, fromToday, listView, monthGrid, papersDue, stagePeers, stageView, type BoardBid } from "@/lib/bid-views";

// Thursday 29 October 2026, 8 PM in the Maldives, when the reminder goes
const NOW = new Date("2026-10-29T15:00:00Z");
const bid = (x: Partial<BoardBid> & { id: string; name: string }): BoardBid => ({
  company: null, location: null, gazette_url: null, status: "registered", prebid_meeting_at: null, prebid_attendance: null, submission_due_at: null, ...x,
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

  it("counts days the way the group reads them", () => {
    const t = "2026-10-29";
    expect(["2026-11-02", "2026-10-31", "2026-10-30", "2026-10-29", "2026-10-28", "2026-10-26"].map((d) => fromToday(t, d)))
      .toEqual(["in 4 days", "in 2 days", "tomorrow", "<b>TODAY</b>", "<b>overdue by 1 day</b>", "<b>overdue by 3 days</b>"]);
  });

  it("has the papers ready two days before the deadline, unless a date is set", () => {
    expect(papersDue({ papers_due_on: null, submission_due_at: "2026-11-04T05:30:00Z" })).toBe("2026-11-02");
    expect(papersDue({ papers_due_on: "2026-11-01", submission_due_at: "2026-11-04T05:30:00Z" })).toBe("2026-11-01");
    expect(papersDue({ papers_due_on: null, submission_due_at: null })).toBeNull();
  });

  it("reminds each morning in the group's layout", () => {
    const callCenter = bid({ id: "cc", name: "Call Center Reception Area Work", company: "Ministry of Health", location: "Malé",
      prebid_meeting_at: "2026-10-30T05:00:00Z", submission_due_at: "2026-11-04T05:30:00Z" });
    expect(dailyDigest([callCenter, bid({ id: "w", name: "Old", status: "won" })], NOW)).toBe([
      "<b>Bid Reminder – 29 Oct 2026 Thursday</b>",
      "",
      "<b>Pre-bid meetings tomorrow</b>",
      "• Call Center Reception Area Work – Ministry of Health",
      "Fri, 30 Oct, 10:00 · Ministry of Health, Malé",
      "",
      "<b>Registered – papers to prepare</b>",
      "• Call Center Reception Area Work – Ministry of Health",
      "Papers ready by: Mon, 2 Nov (in 4 days)",
      "Submission: Wed, 4 Nov, 10:30 (in 6 days)",
      "",
      "<b>Papers ready – awaiting submission</b>",
      "• None",
      "",
      "📊 Open bids: 1",
    ].join("\n"));
  });

  it("shows overdue papers and bids awaiting submission, and keeps quiet when nothing is being prepared", () => {
    const d = dailyDigest(BIDS, NOW)!;
    expect(d).toContain("• Road\nPapers ready by: Sun, 25 Oct (<b>overdue by 4 days</b>)\nSubmission: Tue, 27 Oct, 14:00 (<b>overdue by 2 days</b>)");
    expect(d).toContain("<b>Papers ready – awaiting submission</b>\n• Jetty\nSubmission: Fri, 30 Oct, 14:00 (tomorrow)");
    expect(d).not.toContain("Pre-bid meetings today"); // over by 8 PM
    expect(dailyDigest([bid({ id: "t", name: "Today", status: "papers_ready", submission_due_at: "2026-10-29T05:30:00Z" })], NOW))
      .toContain("Submission: Thu, 29 Oct, 10:30 (<b>overdue</b>)");
    expect(dailyDigest([bid({ id: "n", name: "Tonight", status: "papers_ready", submission_due_at: "2026-10-29T18:00:00Z" })], NOW))
      .toContain("Submission: Thu, 29 Oct, 23:00 (<b>TODAY</b>)");
    expect(d).toMatch(/📊 Open bids: 5$/);
    expect(dailyDigest([BIDS[3], BIDS[4]], NOW)).toBeNull(); // submitted and won only
  });

  it("stays under Telegram's size limit however many bids there are", () => {
    const many = Array.from({ length: 200 }, (_, i) => bid({ id: `m${i}`, name: `Bid number ${i} with a long name for the island`, submission_due_at: "2026-11-05T05:00:00Z" }));
    for (const v of [stageView(many), calendarView(many, NOW), listView(many, NOW), dailyDigest(many, NOW)!]) {
      expect(v.length).toBeLessThan(4096);
      expect(v.match(/<pre>/g)?.length ?? 0).toBe(v.match(/<\/pre>/g)?.length ?? 0);
    }
  });
});
