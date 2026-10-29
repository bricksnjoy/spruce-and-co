import { dueSoon, maldivesDay, soonKey, soonMessage } from "@/lib/bid-views";
import { sendTelegram, telegramReady } from "@/lib/telegram";
import { botAssignments, botBids, botPeople, claimRun, isBotSecret } from "@/server/bid-bot";

/**
 * Two hours before each pre-bid meeting and each submission of a bid not yet
 * submitted, whoever is going is reminded by name (Supabase's timer calls this
 * every 5 minutes; each meeting and submission is reminded once, again only if
 * its time changes).
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!isBotSecret(auth.startsWith("Bearer ") ? auth.slice(7) : null)) return new Response("Not allowed", { status: 401 });
  if (!telegramReady()) return Response.json({ sent: 0, reason: "Telegram is not set up." });
  const now = new Date();
  const r = await botBids();
  if ("error" in r) return Response.json({ sent: 0, reason: r.error }, { status: 500 });
  const due = dueSoon(r.bids, now);
  if (!due.length) return Response.json({ sent: 0 });
  const [assigned, people] = await Promise.all([botAssignments(), botPeople()]);
  let sent = 0;
  for (const d of due) {
    if ((await claimRun(maldivesDay(new Date(d.at)), soonKey(d.bid.id, d.task, d.at))) === false) continue;
    if ((await sendTelegram(soonMessage(d.bid, d.task, assigned, people))).ok) sent++;
  }
  return Response.json({ sent, due: due.length });
}
