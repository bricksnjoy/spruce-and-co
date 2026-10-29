/**
 * The Telegram bot's side of the server: it reads the bids with its own key
 * (no one is signed in when Telegram or the evening timer calls), and keeps the
 * bot pointed at this site. The key is CRON_SECRET, which also signs the
 * evening timer's call (Vercel sends it) and Telegram's deliveries.
 */
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  assignKeyboard, assignMessage, assignTargets, BOT_COMMANDS, dailyDigest, VIEW_KEYS, type Assignment, type BoardBid, type Person, type Task,
} from "@/lib/bid-views";
import { connectTelegram, sendTelegram, telegramCall, telegramWebhook } from "@/lib/telegram";

export const botSecret = () => process.env.CRON_SECRET ?? "";

/** True when the given secret is the bot's (compared in constant time). */
export function isBotSecret(given: string | null | undefined): boolean {
  const s = botSecret();
  if (!s || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Every bid with its stage and dates, read with the bot's key. */
export async function botBids(): Promise<{ bids: BoardBid[] } | { error: string }> {
  if (!botSecret()) return { error: "CRON_SECRET is not set." };
  const { data, error } = await db().rpc("bot_bids", { p_key: botSecret() });
  return error ? { error: error.message } : { bids: (data ?? []) as BoardBid[] };
}

/** Everyone put on a bid's pre-bid meeting or submission. */
export async function botAssignments(): Promise<Assignment[]> {
  const { data } = await db().rpc("bot_assignments", { p_key: botSecret() });
  return (data ?? []) as Assignment[];
}

/** Put a person on a bid's task, or take them off (the same tap); who is on it now. */
export async function botAssign(bid: string, task: Task, user: number | string, name: string) {
  const { data, error } = await db().rpc("bot_assign", { p_key: botSecret(), p_bid: bid, p_task: task, p_user: user, p_name: name });
  return error ? { error: error.message } : { on: (data ?? []) as { user_id: number; name: string }[] };
}

/** A Telegram user as the bot keeps them: their name as the group sees it. */
export const personOf = (u: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }): Person | null =>
  u.is_bot ? null : { user_id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id), username: u.username ?? null };

/**
 * The people the bot knows in the group (Telegram does not let a bot list a
 * group's members): those just seen are added, those who left dropped.
 */
export async function botPeople(seen: Person[] = [], left: (number | string)[] = []): Promise<Person[]> {
  const { data } = await db().rpc("bot_people", {
    p_key: botSecret(), p_seen: seen.map((p) => ({ id: p.user_id, name: p.name, username: p.username ?? "" })), p_left: left,
  });
  return (data ?? []) as Person[];
}

/** The group's admins, whom Telegram does list. */
export async function groupAdmins(): Promise<Person[]> {
  const r = await telegramCall<{ user: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string } }[]>(
    "getChatAdministrators", { chat_id: process.env.TELEGRAM_CHAT_ID });
  return r.ok ? r.result.map((m) => personOf(m.user)).filter((p): p is Person => p !== null) : [];
}

/**
 * True the first time an evening reminder runs on a day (in the Maldives), false
 * after; null when that cannot be checked (better twice than not at all).
 */
export async function claimRun(day: string, step: "remind" | "chase"): Promise<boolean | null> {
  const { data, error } = await db().rpc("bot_claim_run", { p_key: botSecret(), p_day: day, p_step: step });
  return error ? null : data === true;
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
  if ((await telegramWebhook()) === url) {
    // the commands are listed again, in case new ones were added since
    const c = await telegramCall("setMyCommands", { commands: BOT_COMMANDS.map(([command, description]) => ({ command, description })) });
    return c.ok ? { ok: true } : c;
  }
  const r = await connectTelegram(url, botSecret(), BOT_COMMANDS);
  return r.ok ? { ok: true } : r;
}

/**
 * The bid reminder (at 8 PM, or on /reminder): tomorrow's pre-bid meetings, the
 * papers to prepare and the bids awaiting submission; then, for each meeting
 * tomorrow and each set of papers ready that no one has taken, who goes is
 * asked with a button per name.
 */
export async function postReminder(now: Date): Promise<{ sent: boolean; asked: number; reason?: string }> {
  const r = await botBids();
  if ("error" in r) return { sent: false, asked: 0, reason: r.error };
  const [assigned, people] = await Promise.all([botAssignments(), groupAdmins().then((admins) => botPeople(admins))]);
  const text = dailyDigest(r.bids, now, assigned);
  if (!text) return { sent: false, asked: 0, reason: "No bid is being prepared, awaiting submission or meeting tomorrow." };
  const sent = await sendTelegram(text, { keyboard: VIEW_KEYS });
  let asked = 0;
  for (const t of assignTargets(r.bids, now)) {
    if (assigned.some((a) => a.bid_id === t.bid.id && a.task === t.task)) continue;
    if ((await sendTelegram(assignMessage(t.bid, t.task, assigned), { keyboard: assignKeyboard(t.bid, t.task, people, assigned) })).ok) asked++;
  }
  return sent.ok ? { sent: true, asked } : { sent: false, asked, reason: sent.error };
}
