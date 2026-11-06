/**
 * The private address of the calendar feed: a key worked out from CRON_SECRET,
 * so it needs no setting of its own and changes only if that secret does.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { botBids, botSecret } from "./bid-bot";
import type { CalItem } from "@/lib/ics";

export function feedKey(): string | null {
  const s = botSecret();
  return s ? createHmac("sha256", s).update("calendar-feed").digest("hex").slice(0, 40) : null;
}
export function isFeedKey(given: string): boolean {
  const k = feedKey();
  if (!k || given.length !== k.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(k));
}

/** Everything the feed shows, read with the bot's key. */
export async function feedData() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const [bids, items] = await Promise.all([botBids(), db.rpc("bot_calendar_items", { p_key: botSecret() })]);
  if ("error" in bids) return { error: bids.error };
  if (items.error) return { error: items.error.message };
  return { bids: bids.bids, items: (items.data ?? []) as CalItem[] };
}
