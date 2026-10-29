"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveBid, type BidResult } from "@/app/actions/bids";
import { BID_STATUSES, BID_STATUS_LABEL, isoToLocal, type Bid } from "@/lib/bids";
import { hint, input, label, primary } from "@/components/form-styles";
import { Modal } from "@/components/modal";

/** A bid's details: name, company, Gazette link, the pre-bid meeting and the deadline. */
export function BidForm({ bid, onDone }: { bid?: Bid; onDone?: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveBid, null as BidResult | null);
  const [meeting, setMeeting] = useState(isoToLocal(bid?.prebid_meeting_at));

  useEffect(() => {
    if (!state?.ok || !state.id) return;
    if (state.note) alert(state.note);
    onDone?.();
    if (bid) router.refresh(); else router.push(`/bids/${state.id}`);
  }, [state, bid, onDone, router]);

  return (
    <form action={action} className="space-y-4">
      {bid && <input type="hidden" name="id" value={bid.id} />}
      <div>
        <label htmlFor="b-name" className={label}>Bid name</label>
        <input id="b-name" name="name" required defaultValue={bid?.name} className={input} placeholder="e.g. Construction of school hall, Th. Vilufushi" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="b-company" className={label}>Company</label>
          <input id="b-company" name="company" defaultValue={bid?.company ?? ""} className={input} placeholder="Who put it out to tender" />
        </div>
        <div>
          <label htmlFor="b-location" className={label}>Location</label>
          <input id="b-location" name="location" required={!bid} defaultValue={bid?.location ?? ""} className={input} placeholder="e.g. Th. Vilufushi" />
        </div>
        {!bid && (
          <div>
            <label htmlFor="b-status" className={label}>Stage</label>
            <select id="b-status" name="status" defaultValue="registered" className={input}>
              {BID_STATUSES.map((s) => <option key={s} value={s}>{BID_STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        )}
      </div>
      <div>
        <label htmlFor="b-gazette" className={label}>Gazette link</label>
        <input id="b-gazette" name="gazette_url" type="url" defaultValue={bid?.gazette_url ?? ""} className={input} placeholder="https://www.gazette.gov.mv/iulaan/…" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="b-meeting" className={label}>Pre-bid meeting</label>
          <input id="b-meeting" name="prebid_meeting_at" type="datetime-local" value={meeting} onChange={(e) => setMeeting(e.target.value)} className={input} />
          {meeting && (
            <div className="mt-2 flex gap-4 text-sm" role="radiogroup" aria-label="Pre-bid meeting attendance">
              {(["compulsory", "optional"] as const).map((a) => (
                <label key={a} className="flex items-center gap-1.5">
                  <input type="radio" name="prebid_attendance" value={a} defaultChecked={(bid?.prebid_attendance ?? "compulsory") === a} />
                  {a === "compulsory" ? "Compulsory" : "Optional"}
                </label>
              ))}
            </div>
          )}
        </div>
        <div>
          <label htmlFor="b-due" className={label}>Submission deadline</label>
          <input id="b-due" name="submission_due_at" type="datetime-local" defaultValue={isoToLocal(bid?.submission_due_at)} className={input} />
          <p className={hint}>Both dates go on Tasks &amp; Calendar. Maldives time.</p>
        </div>
      </div>
      <div>
        <label htmlFor="b-notes" className={label}>Notes</label>
        <textarea id="b-notes" name="notes" rows={2} defaultValue={bid?.notes ?? ""} className={input} />
      </div>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className={primary}>{pending ? "Saving…" : bid ? "Save changes" : "Add bid"}</button>
    </form>
  );
}

/** "New bid" / "Edit" opening the form in a pop-up. */
export function BidFormButton({ bid, className }: { bid?: Bid; className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{bid ? "Edit" : "+ New bid"}</button>
      {open && (
        <Modal title={bid ? "Edit bid" : "New bid"} onClose={() => setOpen(false)} size="md">
          <BidForm bid={bid} onDone={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}
