/**
 * Posts to the company's Telegram group through a bot, using Telegram's plain
 * HTTP API. Switched on by TELEGRAM_BOT_TOKEN (from @BotFather) and
 * TELEGRAM_CHAT_ID (the group's id, which starts with -100) being set in the
 * environment; without them nothing is sent and nothing fails.
 */
import type { SendOutcome } from "./messaging";

export function telegramReady(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Telegram's HTML mode: only &, < and > need escaping in text. */
export const tg = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Send a message (Telegram HTML: <b>, <i>, <a href>) to the group. */
export async function sendTelegram(html: string): Promise<SendOutcome> {
  if (!telegramReady()) return { ok: false, error: "Telegram is not set up." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
    if (!res.ok || !data.ok) return { ok: false, error: data.description ?? `Telegram answered ${res.status}` };
    return { ok: true, id: data.result?.message_id != null ? String(data.result.message_id) : null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
