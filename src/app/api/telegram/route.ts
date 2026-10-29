import { COMMAND_VIEW, renderView, VIEW_KEYS, type BidView } from "@/lib/bid-views";
import { editTelegram, sendTelegram, telegramCall, telegramReady } from "@/lib/telegram";
import { botBids, isBotSecret } from "@/server/bid-bot";

type Update = {
  message?: { text?: string; chat?: { id?: number } };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat?: { id?: number } } };
};
const VIEWS: Record<string, BidView> = { "v:cal": "cal", "v:list": "list", "v:stage": "stage" };

/**
 * What Telegram sends from the group: a command (/bids, /calendar, /list) is
 * answered with that view, and a button under a view switches it in place.
 * Only the company's group is answered; anything else is taken and ignored.
 */
export async function POST(request: Request) {
  if (!telegramReady() || !isBotSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("Not allowed", { status: 401 });
  }
  const update = (await request.json().catch(() => ({}))) as Update;
  const group = String(process.env.TELEGRAM_CHAT_ID);

  const msg = update.message;
  const command = msg?.text && String(msg.chat?.id) === group ? /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(msg.text)?.[1]?.toLowerCase() : undefined;
  const asked = command ? COMMAND_VIEW[command] : undefined;
  if (asked) {
    const r = await botBids();
    await sendTelegram("error" in r ? `The bids could not be read: ${r.error}` : renderView(asked, r.bids, new Date()), { keyboard: VIEW_KEYS });
  }

  const press = update.callback_query;
  if (press) {
    const view = press.data ? VIEWS[press.data] : undefined;
    const where = press.message;
    if (view && where && String(where.chat?.id) === group) {
      const r = await botBids();
      if (!("error" in r)) await editTelegram(where.chat!.id!, where.message_id, renderView(view, r.bids, new Date()), VIEW_KEYS);
    }
    await telegramCall("answerCallbackQuery", { callback_query_id: press.id });
  }
  return Response.json({ ok: true });
}
