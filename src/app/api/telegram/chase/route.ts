import { assignKeyboard, assignTargets, chaseMessage, maldivesDay } from "@/lib/bid-views";
import { sendTelegram, telegramReady } from "@/lib/telegram";
import { botAssignments, botBids, botPeople, claimRun, groupAdmins, isBotSecret } from "@/server/bid-bot";

/**
 * At 9 PM Maldives time (timed like the 8 PM reminder): a pre-bid meeting
 * tomorrow, or papers ready, that still has no one on it calls everyone in the
 * group by name, with the names to tap.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!isBotSecret(auth.startsWith("Bearer ") ? auth.slice(7) : null)) return new Response("Not allowed", { status: 401 });
  if (!telegramReady()) return Response.json({ sent: 0, reason: "Telegram is not set up." });
  const now = new Date();
  if ((await claimRun(maldivesDay(now), "chase")) === false) return Response.json({ sent: 0, reason: "Already done today." });

  const r = await botBids();
  if ("error" in r) return Response.json({ sent: 0, reason: r.error }, { status: 500 });
  const [assigned, people] = await Promise.all([botAssignments(), groupAdmins().then((admins) => botPeople(admins))]);
  const open = assignTargets(r.bids, now).filter((t) => !assigned.some((a) => a.bid_id === t.bid.id && a.task === t.task));
  let sent = 0;
  for (const [i, t] of open.entries()) {
    const ok = await sendTelegram(chaseMessage(t.bid, t.task, people, i === 0), { keyboard: assignKeyboard(t.bid, t.task, people, assigned) });
    if (ok.ok) sent++;
  }
  return Response.json({ sent, open: open.length });
}
