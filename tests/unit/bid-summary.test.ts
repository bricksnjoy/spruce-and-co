import { describe, expect, it } from "vitest";
import { SUMMARY_PRESS, summaryKeys, summaryMessage, unhexId } from "@/lib/bid-summary";

const BID = { name: "Call Center reception Area Work", company: "Ministry of Health", gazette_url: "https://www.gazette.gov.mv/iulaan/418055" };
const ID = "4c1f2d3e-1111-4222-8333-444455556666";

describe("a submitted bid's summary", () => {
  it("reads as the group asked", () => {
    expect(summaryMessage(BID)).toBe(
      "Bid Name: Call Center reception Area Work by Ministry of Health\nBid submitted,\nGazette Notice: https://www.gazette.gov.mv/iulaan/418055");
  });
  it("puts the result and who pressed it on top", () => {
    expect(summaryMessage(BID, { result: { status: "won", by: "Muaz" } }).split("\n")[0]).toBe("<b>✅ Bid won</b> (Muaz)");
  });
  it("has Won and Lost buttons that name the bid", () => {
    const [[won, lost]] = summaryKeys(ID);
    expect(won[0]).toBe("✅ Won");
    expect(lost[0]).toBe("❌ Lost");
    const m = SUMMARY_PRESS.exec(lost[1])!;
    expect(m[1]).toBe("l");
    expect(unhexId(m[2])).toBe(ID);
    expect(lost[1].length).toBeLessThanOrEqual(64); // Telegram's limit on button data
  });
});
