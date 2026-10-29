import { dailyDigest, VIEW_KEYS } from "@/lib/bid-views";
import { sendTelegram, telegramReady } from "@/lib/telegram";
import { botBids, ensureWebhook, isBotSecret } from "@/server/bid-bot";

/**
 * The evening reminder (Vercel's timer calls this at 8 PM Maldives time, 15:00
 * UTC, see vercel.json): tomorrow's pre-bid meetings, the papers to prepare and
 * the bids awaiting submission, posted to the group when there is anything to
 * say. It also keeps the bot's commands connected.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!isBotSecret(auth.startsWith("Bearer ") ? auth.slice(7) : null)) return new Response("Not allowed", { status: 401 });
  if (!telegramReady()) return Response.json({ sent: false, reason: "Telegram is not set up." });
  const hook = await ensureWebhook(new URL(request.url).host);
  const r = await botBids();
  if ("error" in r) return Response.json({ sent: false, reason: r.error }, { status: 500 });
  const text = dailyDigest(r.bids, new Date());
  if (!text) return Response.json({ sent: false, reason: "No bid is being prepared or awaiting submission.", commands: hook.ok });
  const sent = await sendTelegram(text, { keyboard: VIEW_KEYS });
  return Response.json({ sent: sent.ok, ...(sent.ok ? {} : { reason: sent.error }), commands: hook.ok ? true : hook.error });
}
