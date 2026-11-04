/**
 * A submitted bid's summary in the Telegram group's "Bid summary" topic: the
 * signing sheet's picture, a message, and Won / Lost buttons that move the bid
 * on the site.
 */
import { tg, type Keyboard } from "./telegram";
import { BID_STATUS_LABEL, type Bid, type BidStatus } from "./bids";

const hex = (id: string) => id.replace(/-/g, "");
export const unhexId = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
/** What a Won or Lost press sends back: bs:w:<bid> or bs:l:<bid>. */
export const SUMMARY_PRESS = /^bs:([wl]):([0-9a-f]{32})$/;
export const summaryKeys = (bidId: string): Keyboard => [[["✅ Won", `bs:w:${hex(bidId)}`], ["❌ Lost", `bs:l:${hex(bidId)}`]]];

/**
 * The summary's text, as the group reads it:
 *   Bid Name: <name> by <company>
 *   Bid submitted,
 *   Gazette Notice: <link>
 * Once Won or Lost is pressed, the result and who pressed it go on top.
 */
export function summaryMessage(b: Pick<Bid, "name" | "company" | "gazette_url">, opts: { result?: { status: BidStatus; by?: string | null } } = {}): string {
  const lines: string[] = [];
  if (opts.result) lines.push(`<b>${opts.result.status === "won" ? "✅" : "❌"} ${BID_STATUS_LABEL[opts.result.status]}</b>${opts.result.by ? ` (${tg(opts.result.by)})` : ""}`, "");
  lines.push(`Bid Name: ${tg(b.name)}${b.company ? ` by ${tg(b.company)}` : ""}`, "Bid submitted,");
  if (b.gazette_url) lines.push(`Gazette Notice: ${tg(b.gazette_url)}`);
  return lines.join("\n");
}
