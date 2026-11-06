import { calendarEvents, icsFeed } from "@/lib/ics";
import { feedData, isFeedKey } from "@/server/calendar-feed";

export const dynamic = "force-dynamic";

/**
 * The calendar feed Google Calendar subscribes to (/api/calendar/<key>.ics):
 * open bids' dates, project tasks and milestones. The key in the address is
 * the only lock, so the address is kept private.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isFeedKey(key.replace(/\.ics$/i, ""))) return new Response("Not found", { status: 404 });
  const data = await feedData();
  if ("error" in data) return new Response(`The calendar could not be read: ${data.error}`, { status: 503 });
  const site = new URL(request.url).origin;
  return new Response(icsFeed(calendarEvents(data.bids, data.items, site)), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="spruce-and-co.ics"', "Cache-Control": "no-store" },
  });
}
