"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBidNote, deleteBid, setBidStatus } from "@/app/actions/bids";
import { BID_STATUSES, BID_STATUS_LABEL, BID_STATUS_TONE, type BidStatus } from "@/lib/bids";
import { input, small } from "@/components/form-styles";

/** Move the bid along: one press per stage, with an optional note that goes to the group too. */
export function StageControl({ id, status }: { id: string; status: BidStatus }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ error?: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const move = (s: BidStatus) => start(async () => {
    const r = await setBidStatus(id, s, note);
    if (r.error) return setMsg({ error: true, text: r.error });
    setNote("");
    setMsg(r.note ? { error: true, text: r.note } : { text: `Moved to ${BID_STATUS_LABEL[s]}.` });
    router.refresh();
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {BID_STATUSES.map((s) => (
          <button key={s} type="button" disabled={pending || s === status} onClick={() => move(s)} aria-pressed={s === status}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:cursor-default ${
              s === status ? `${BID_STATUS_TONE[s]} ring-1 ring-current` : "border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-60"
            }`}>
            {BID_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <textarea aria-label="Note with the change (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={input}
        placeholder="Note with the change (optional), e.g. papers handed in at the island council" />
      {msg && <p className={`text-xs ${msg.error ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p>}
    </div>
  );
}

/** A note on the bid's history; it stays here and is not sent to the group. */
export function NoteForm({ id }: { id: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="flex gap-2" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await addBidNote(id, note);
        if (r.error) return setError(r.error);
        setNote(""); setError(null); router.refresh();
      });
    }}>
      <input aria-label="Add a note" value={note} onChange={(e) => setNote(e.target.value)} className={input} placeholder="Add a note" />
      <button type="submit" className={small} disabled={pending || !note.trim()}>Add</button>
      {error && <span className="self-center text-xs text-red-700">{error}</span>}
    </form>
  );
}

export function DeleteBid({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} className="text-xs text-[var(--muted)] hover:text-red-700"
      onClick={() => {
        if (!confirm("Delete this bid and its history? This cannot be undone.")) return;
        start(async () => {
          const r = await deleteBid(id);
          if (r.error) alert(r.error); else router.push("/bids");
        });
      }}>
      Delete
    </button>
  );
}
