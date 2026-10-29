import { describe, expect, it } from "vitest";
import { bidMessage, isoToLocal, localToIso, type Bid } from "@/lib/bids";

const bid: Bid = {
  id: "b1", name: "School hall <Th.>", company: "Ministry of Education", gazette_url: "https://www.gazette.gov.mv/iulaan/123",
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

  it("tells the group about a new bid with its dates and links, escaping what was typed", () => {
    const m = bidMessage("added", bid, { link: "https://www.spruceandco.org/bids/b1", by: "Muaz" });
    expect(m).toContain("🆕 New bid");
    expect(m).toContain("<b>School hall &lt;Th.&gt;</b> — Ministry of Education");
    expect(m).toContain("Stage: Registered");
    expect(m).toContain("Pre-bid meeting: Tue, 3 Nov 2026, 10:00 (compulsory)");
    expect(m).toContain("Submission due: Fri, 20 Nov 2026, 13:30");
    expect(m).toContain('<a href="https://www.gazette.gov.mv/iulaan/123">Gazette notice</a>');
    expect(m).toContain("<i>by Muaz</i>");
  });

  it("says where the bid moved, and the note with it", () => {
    expect(bidMessage("status", { ...bid, status: "papers_ready" }, { note: "signed & stamped" })).toMatch(/^📌 Bid moved to: Papers ready[\s\S]*Note: signed &amp; stamped$/);
    expect(bidMessage("status", { ...bid, status: "won" })).toMatch(/^🏆 Bid won/);
    expect(bidMessage("dates", bid)).toMatch(/^📅 Bid dates changed/);
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
