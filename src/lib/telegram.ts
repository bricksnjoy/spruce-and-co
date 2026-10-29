/**
 * Posts to the company's Telegram group through a bot, using Telegram's plain
 * HTTP API. Switched on by TELEGRAM_BOT_TOKEN (from @BotFather) and
 * TELEGRAM_CHAT_ID (the group's id) being set in the environment; without them
 * nothing is sent and nothing fails. In a group with topics, TELEGRAM_TOPIC_ID
 * is the topic the bids go to (the number at the end of the topic's link).
 */
import type { SendOutcome } from "./messaging";

/**
 * The bot's token (digits, a colon, then 35 letters): picked out of whatever was
 * pasted, so "bot123:ABC…", the getUpdates address or stray spaces still work.
 */
export function botToken(raw = process.env.TELEGRAM_BOT_TOKEN): string | null {
  const v = (raw ?? "").trim();
  return /\d{5,}:[A-Za-z0-9_-]{30,}/.exec(v)?.[0] ?? (v || null);
}

export function telegramReady(): boolean {
  return Boolean(botToken() && process.env.TELEGRAM_CHAT_ID);
}

/** Telegram's HTML mode: only &, < and > need escaping in text. */
export const tg = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Buttons under a message: each row a list of [label, what pressing it sends back]. */
export type Keyboard = [string, string][][];
const markup = (k?: Keyboard) => (k ? { inline_keyboard: k.map((row) => row.map(([text, callback_data]) => ({ text, callback_data }))) } : undefined);

/** One call to the bot API; the result, or Telegram's reason for refusing. */
export async function telegramCall<T = unknown>(method: string, body: Record<string, unknown>): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const token = botToken();
  if (!token) return { ok: false, error: "Telegram is not set up." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: T; parameters?: { migrate_to_chat_id?: number } };
    // Telegram answers an unknown token with a bare "Not Found"
    if (res.status === 404 || res.status === 401) {
      return { ok: false, error: "Telegram does not recognise the bot token. Copy it again from @BotFather into TELEGRAM_BOT_TOKEN on Vercel, then redeploy." };
    }
    // a group turned into one with topics gets a new id
    if (data.parameters?.migrate_to_chat_id) {
      return { ok: false, error: `The Telegram group was upgraded and has a new id: set TELEGRAM_CHAT_ID on Vercel to ${data.parameters.migrate_to_chat_id}, then redeploy.` };
    }
    if (!res.ok || !data.ok) return { ok: false, error: data.description ?? `Telegram answered ${res.status}` };
    return { ok: true, result: data.result as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Send a message (Telegram HTML: <b>, <i>, <a href>, <pre>) to the group, or to another chat. */
/** The topic the bids go to, in a group with topics. */
export const bidTopic = () => (/^\d+$/.test(process.env.TELEGRAM_TOPIC_ID ?? "") ? Number(process.env.TELEGRAM_TOPIC_ID) : undefined);

export async function sendTelegram(html: string, opts: { keyboard?: Keyboard; chatId?: string | number; topic?: number } = {}): Promise<SendOutcome> {
  if (!telegramReady()) return { ok: false, error: "Telegram is not set up." };
  const r = await telegramCall<{ message_id?: number }>("sendMessage", {
    chat_id: opts.chatId ?? process.env.TELEGRAM_CHAT_ID, message_thread_id: opts.topic ?? (opts.chatId ? undefined : bidTopic()),
    text: html, parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: markup(opts.keyboard),
  });
  return r.ok ? { ok: true, id: r.result.message_id != null ? String(r.result.message_id) : null } : r;
}

/** Replace a message's text and buttons (a view switched with its buttons). */
export async function editTelegram(chatId: string | number, messageId: number, html: string, keyboard?: Keyboard) {
  const r = await telegramCall("editMessageText", {
    chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup(keyboard),
  });
  // pressing the button of the view already shown changes nothing; Telegram calls that an error
  return r.ok || /not modified/i.test(r.error) ? { ok: true as const } : r;
}

/**
 * Point the bot at this site, so the group's commands and button presses reach
 * it, and list the commands in Telegram's menu. Telegram signs each delivery
 * with the secret, which is how the site knows it came from Telegram.
 */
export async function connectTelegram(webhookUrl: string, secret: string, commands: [string, string][]) {
  const hook = await telegramCall("setWebhook", {
    url: webhookUrl, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true,
  });
  if (!hook.ok) return hook;
  return telegramCall("setMyCommands", { commands: commands.map(([command, description]) => ({ command, description })) });
}

/** Where the bot sends what happens in the group, if anywhere. */
export async function telegramWebhook() {
  const r = await telegramCall<{ url?: string }>("getWebhookInfo", {});
  return r.ok ? r.result.url ?? "" : null;
}
