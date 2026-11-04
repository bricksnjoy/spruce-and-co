"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { shrinkForReading } from "@/lib/shrink-photo";
import { useRouter } from "next/navigation";
import { addBidNote, deleteBid, setBidStatus, submitBid } from "@/app/actions/bids";
import { BID_STATUSES, BID_STATUS_LABEL, BID_STATUS_TONE, type BidStatus } from "@/lib/bids";
import { input, label, primary, small } from "@/components/form-styles";

/** Move the bid along: one press per stage, with an optional note that goes to the group too. */
export function StageControl({ id, status }: { id: string; status: BidStatus }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ error?: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [sheet, setSheet] = useState<File | null>(null);
  // handing in the bid comes with its signing sheet, which goes to the Bid summary topic
  const submit = () => start(async () => {
    const fd = new FormData();
    fd.set("id", id); fd.set("note", note);
    // a phone photo is made smaller so it fits through (the site takes up to 4MB)
    if (sheet) fd.set("sheet", await shrinkForReading(sheet, 2400));
    const r = await submitBid(null, fd);
    if (r.error) return setMsg({ error: true, text: r.error });
    setNote(""); setSheet(null); setSubmitting(false);
    setMsg(r.note ? { error: true, text: r.note } : { text: "Submitted, and the summary is in the Bid summary topic." });
    router.refresh();
  });
  const move = (s: BidStatus) => s === "submitted" ? setSubmitting(true) : start(async () => {
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
      {submitting && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium">Bid submitted</p>
          <div><label htmlFor="bid-sheet" className={label}>Signing sheet (photo or scan)</label>
            <input id="bid-sheet" type="file" accept="image/*" capture="environment" onChange={(e) => setSheet(e.target.files?.[0] ?? null)} className="block text-sm" />
            <p className="mt-1 text-xs text-[var(--muted)]">Sent to the Bid summary topic with the bid and Won / Lost buttons.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={submit} className={primary}>{pending ? "Sending…" : sheet ? "Submit and send" : "Submit without a picture"}</button>
            <button type="button" onClick={() => { setSubmitting(false); setSheet(null); }} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
          </div>
        </div>
      )}
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

/** A won bid becomes a project: the new-project form opens filled in from the bid, and the two are linked. */
export function MakeProject({ id, projectId, projectCode }: { id: string; projectId: string | null; projectCode: string | null }) {
  if (projectId) return <Link href={`/projects/${projectId}`} className={small}>Open project {projectCode ?? ""}</Link>;
  return <Link href={`/projects/new?bid=${id}`} className={`${primary} inline-block`}>Turn into a project</Link>;
}
