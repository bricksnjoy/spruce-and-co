/**
 * The Telegram bot's side of the server: it reads the bids with its own key
 * (no one is signed in when Telegram or the morning timer calls), and keeps the
 * bot pointed at this site. The key is CRON_SECRET, which also signs the
 * morning timer's call (Vercel sends it) and Telegram's deliveries.
 */
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { BOT_COMMANDS, type BoardBid } from "@/lib/bid-views";
import { connectTelegram, telegramWebhook } from "@/lib/telegram";

export const botSecret = () => process.env.CRON_SECRET ?? "";

/** True when the given secret is the bot's (compared in constant time). */
export function isBotSecret(given: string | null | undefined): boolean {
  const s = botSecret();
  if (!s || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every bid with its stage and dates, read with the bot's key. */
export async function botBids(): Promise<{ bids: BoardBid[] } | { error: string }> {
  if (!botSecret()) return { error: "CRON_SECRET is not set." };
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.rpc("bot_bids", { p_key: botSecret() });
  return error ? { error: error.message } : { bids: (data ?? []) as BoardBid[] };
}

/** Where Telegram sends the group's commands and button presses: the live site. */
export function webhookUrl(host?: string | null): string | null {
  const h = process.env.VERCEL_PROJECT_PRODUCTION_URL || host;
  return h ? `https://${h}/api/telegram` : null;
}

/** Point the bot at this site, unless it already is. */
export async function ensureWebhook(host?: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = webhookUrl(host);
  if (!url || !botSecret()) return { ok: false, error: "The site's address or CRON_SECRET is missing." };
  if ((await telegramWebhook()) === url) return { ok: true };
  const r = await connectTelegram(url, botSecret(), BOT_COMMANDS);
  return r.ok ? { ok: true } : r;
}
