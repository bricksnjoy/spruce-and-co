import { describe, expect, it } from "vitest";
import { bidMessage, isoToLocal, localToIso, type Bid } from "@/lib/bids";

const bid: Bid = {
  id: "b1", name: "School hall <Th.>", company: "Ministry of Education", location: "Th. Vilufushi", gazette_url: "https://www.gazette.gov.mv/iulaan/123",
  status: "registered", prebid_meeting_at: "2026-11-03T05:00:00.000Z", prebid_attendance: "compulsory",
  submission_due_at: "2026-11-20T08:30:00.000Z", notes: null, project_id: null,
};

describe("bids", () => {
  it("reads and shows dates in Maldives time", () => {
    expect(localToIso("2026-11-03T10:00")).toBe("2026-11-03T05:00:00.000Z");
    expect(isoToLocal("2026-11-03T05:00:00.000Z")).toBe("2026-11-03T10:00");
    expect(localToIso("")).toBeNull();
    expect(localToIso("next week")).toBeNull();
  });

  it("tells the group the stage in bold, then the bid's name, dates, location and Gazette notice", () => {
    expect(bidMessage("status", bid).split("\n")).toEqual([
      "<b>Bid Status update - Registered</b>",
      "",
      "Bid Name: School hall &lt;Th.&gt; by Ministry of Education",
      "Pre-bid meeting: 3rd November 2026 10:00 (compulsory)",
      "Bid submission date: <b>20th November 2026 13:30</b>",
      "Location: Th. Vilufushi",
      'Gazette Notice: <a href="https://www.gazette.gov.mv/iulaan/123">https://www.gazette.gov.mv/iulaan/123</a>',
    ]);
  });

  it("leaves out the pre-bid meeting when there is none, and says what is missing", () => {
    const m = bidMessage("added", { ...bid, prebid_meeting_at: null, location: null, gazette_url: null, submission_due_at: null, company: null });
    expect(m).toMatch(/^<b>New bid - Registered<\/b>\n\nBid Name: School hall &lt;Th.&gt;\n/);
    expect(m).not.toContain("Pre-bid");
    expect(m).toContain("Bid submission date: —\nLocation: —\nGazette Notice: —");
  });

  it("says where the bid moved, and the note with it", () => {
    expect(bidMessage("status", { ...bid, status: "papers_ready" }, { note: "signed & stamped" })).toMatch(/^<b>Bid Status update - Papers ready<\/b>[\s\S]*\n\nNote: signed &amp; stamped$/);
    expect(bidMessage("status", { ...bid, status: "won" })).toMatch(/^<b>Bid Status update - Bid won<\/b>/);
    expect(bidMessage("dates", bid)).toMatch(/^<b>Bid dates changed - Registered<\/b>/);
  });

  it("writes dates the long way, with the right ending", async () => {
    const { longWhen } = await import("@/lib/bids");
    expect(longWhen("2026-11-04T05:30:00Z")).toBe("4th November 2026 10:30");
    expect(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-21", "2026-11-22", "2026-11-23"]
      .map((d) => longWhen(`${d}T03:00:00Z`).split(" ")[0])).toEqual(["1st", "2nd", "3rd", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
  });
});

describe("the bot token", () => {
  it("is picked out of whatever was pasted", async () => {
    const { botToken } = await import("@/lib/telegram");
    const t = "123456789:AAFakeTokenForTests_abcdefghijklmnopq";
    expect(botToken(t)).toBe(t);
    expect(botToken(` bot${t}\n`)).toBe(t);
    expect(botToken(`https://api.telegram.org/bot${t}/getUpdates`)).toBe(t);
    expect(botToken(`"${t}"`)).toBe(t);
    expect(botToken("")).toBeNull();
    expect(botToken(undefined)).toBeNull();
  });
});

describe("the bids' topic", () => {
  it("is the number from the topic's link, or none", async () => {
    const { bidTopic } = await import("@/lib/telegram");
    const was = process.env.TELEGRAM_TOPIC_ID;
    try {
      process.env.TELEGRAM_TOPIC_ID = "5";
      expect(bidTopic()).toBe(5);
      process.env.TELEGRAM_TOPIC_ID = "";
      expect(bidTopic()).toBeUndefined();
      process.env.TELEGRAM_TOPIC_ID = "Bid timelines";
      expect(bidTopic()).toBeUndefined();
    } finally { process.env.TELEGRAM_TOPIC_ID = was; }
  });
});
