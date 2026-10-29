"use client";

import { useState, useTransition } from "react";
import { postBidBoard } from "@/app/actions/bids";
import { small } from "@/components/form-styles";

/** Post every bid, stage by stage, to the Telegram group, with its calendar and list buttons (admin). */
export function TelegramBoardButton() {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={small} disabled={pending}
        onClick={() => start(async () => {
          const r = await postBidBoard();
          setSaid(r.error ? { ok: false, text: r.error } : { ok: true, text: r.note ?? "Posted." });
        })}>
        {pending ? "Posting…" : "Post board to Telegram"}
      </button>
      {said && <span className={`text-xs ${said.ok ? "text-emerald-700" : "text-red-700"}`}>{said.text}</span>}
    </div>
  );
}
