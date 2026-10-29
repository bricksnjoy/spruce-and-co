import { maldivesDay } from "@/lib/bid-views";
import { telegramReady } from "@/lib/telegram";
import { claimRun, ensureWebhook, isBotSecret, postReminder } from "@/server/bid-bot";

/**
 * The evening reminder, at 8 PM Maldives time (Supabase's timer calls this on
 * the minute; Vercel's, in vercel.json, is the fallback, and only the first call
 * of the day sends). It also keeps the bot's commands connected.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!isBotSecret(auth.startsWith("Bearer ") ? auth.slice(7) : null)) return new Response("Not allowed", { status: 401 });
  if (!telegramReady()) return Response.json({ sent: false, reason: "Telegram is not set up." });
  const now = new Date();
  if ((await claimRun(maldivesDay(now), "remind")) === false) return Response.json({ sent: false, reason: "Already sent today." });
  const hook = await ensureWebhook(new URL(request.url).host);
  const r = await postReminder(now);
  return Response.json({ ...r, commands: hook.ok ? true : hook.error });
}
