import {
  assignKeyboard, assignMessage, COMMAND_VIEW, renderView, TASK_OF, unhex, VIEW_KEYS, type BidView, type Person,
} from "@/lib/bid-views";
import { editTelegram, sendTelegram, telegramCall, telegramReady } from "@/lib/telegram";
import { botAssign, botAssignments, botBids, botPeople, isBotSecret, personOf, postReminder } from "@/server/bid-bot";

type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
type Update = {
  message?: { text?: string; chat?: { id?: number }; from?: TgUser; new_chat_members?: TgUser[]; left_chat_member?: TgUser };
  callback_query?: { id: string; data?: string; from?: TgUser; message?: { message_id: number; chat?: { id?: number } } };
};
const VIEWS: Record<string, BidView> = { "v:cal": "cal", "v:list": "list", "v:stage": "stage" };

/**
 * What Telegram sends from the group. A command (/bids, /calendar, /list) is
 * answered with that view, and /reminder sends the 8 PM reminder now; a view's button switches it in place; a name's
 * button puts that person on a bid's pre-bid meeting or submission, or takes
 * them off (✋ Me: whoever tapped). Everyone seen in the group is remembered,
 * since Telegram does not let a bot list a group's members. Only the company's
 * group is answered; anything else is taken and ignored.
 */
export async function POST(request: Request) {
  if (!telegramReady() || !isBotSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("Not allowed", { status: 401 });
  }
  const update = (await request.json().catch(() => ({}))) as Update;
  const group = String(process.env.TELEGRAM_CHAT_ID);
  const msg = String(update.message?.chat?.id) === group ? update.message : undefined;
  const press = update.callback_query;
  const inGroup = press && String(press.message?.chat?.id) === group;

  // whoever writes, joins, leaves or taps in the group
  const seen = [msg?.from, ...(msg?.new_chat_members ?? []), inGroup ? press.from : undefined]
    .map((u) => (u ? personOf(u) : null)).filter((p): p is Person => p !== null);
  const left = msg?.left_chat_member ? [msg.left_chat_member.id] : [];
  let people = seen.length || left.length ? await botPeople(seen, left) : null;

  const command = msg?.text ? /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(msg.text)?.[1]?.toLowerCase() : undefined;
  const asked = command ? COMMAND_VIEW[command] : undefined;
  if (asked) {
    const r = await botBids();
    await sendTelegram("error" in r ? `The bids could not be read: ${r.error}` : renderView(asked, r.bids, new Date()), { keyboard: VIEW_KEYS });
  } else if (command === "reminder") {
    const r = await postReminder(new Date());
    if (!r.sent) await sendTelegram(`Nothing to remind: ${r.reason ?? "the reminder could not be sent."}`);
  }

  if (press) {
    let toast: string | undefined;
    const where = press.message;
    const view = press.data ? VIEWS[press.data] : undefined;
    const pick = /^(as|me):([0-9a-f]{32}):([ps])(?::(\d+))?$/.exec(press.data ?? "");
    if (inGroup && where && view) {
      const r = await botBids();
      if (!("error" in r)) await editTelegram(where.chat!.id!, where.message_id, renderView(view, r.bids, new Date()), VIEW_KEYS);
    } else if (inGroup && where && pick) {
      const bid = unhex(pick[2]), task = TASK_OF[pick[3]];
      people ??= await botPeople();
      const who = pick[1] === "me" ? (press.from ? personOf(press.from) : null) : people.find((p) => String(p.user_id) === pick[4]);
      if (who) {
        const r = await botAssign(bid, task, who.user_id, who.name);
        if ("error" in r) toast = r.error;
        else {
          toast = r.on.some((x) => String(x.user_id) === String(who.user_id))
            ? `${who.name} ${task === "prebid" ? "is going" : "is submitting"}` : `${who.name} taken off`;
          const [bids, assigned] = await Promise.all([botBids(), botAssignments()]);
          const b = "error" in bids ? undefined : bids.bids.find((x) => x.id === bid);
          if (b) await editTelegram(where.chat!.id!, where.message_id, assignMessage(b, task, assigned), assignKeyboard(b, task, people, assigned));
        }
      }
    }
    await telegramCall("answerCallbackQuery", { callback_query_id: press.id, ...(toast ? { text: toast } : {}) });
  }
  return Response.json({ ok: true });
}
