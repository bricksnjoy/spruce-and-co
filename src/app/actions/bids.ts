"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { canWrite, dbMessage, getSession, type Session } from "@/server/session";
import { bidMessage, isBidStatus, localToIso, type Bid } from "@/lib/bids";
import { stagePeers, stageView, VIEW_KEYS, type BoardBid } from "@/lib/bid-views";
import { sendTelegram, telegramReady } from "@/lib/telegram";
import { ensureWebhook } from "@/server/bid-bot";

export type BidResult = { error?: string; ok?: boolean; id?: string; note?: string };
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const text = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v === "" ? null : v; };
const COLS = "id, name, company, location, gazette_url, status, prebid_meeting_at, prebid_attendance, papers_due_on, submission_due_at, notes, project_id";

async function writer() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!canWrite(s.role)) return { error: "You can view bids but not change them." } as const;
  if (s.book !== "live") return { error: "Bids are kept in the Live book; switch to Live to change them." } as const;
  return { s } as const;
}

function refresh(id?: string) {
  revalidatePath("/bids");
  if (id) revalidatePath(`/bids/${id}`);
  revalidatePath("/tasks");
}

/**
 * Post to the Telegram group; a failure is reported back, never undoes the save.
 * A new bid or a change of stage comes with every bid now at that stage.
 */
async function tell(kind: Parameters<typeof bidMessage>[0], b: Bid, s: Session, note?: string | null) {
  if (!telegramReady()) return undefined;
  const { data: peers } = kind === "dates" ? { data: null } : await s.supabase.from("bids").select(COLS).eq("status", b.status);
  let text = bidMessage(kind, b, { note });
  if (peers) text += `\n${stagePeers(peers as BoardBid[], b.status, b.id)}`;
  const r = await sendTelegram(text);
  return r.ok ? undefined : `Saved, but the Telegram message did not go: ${r.error}`;
}

/** Add a bid, or change its details. */
export async function saveBid(_prev: unknown, fd: FormData): Promise<BidResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const id = text(fd, "id");
  if (id && !isId(id)) return { error: "No such bid." };
  const name = text(fd, "name");
  if (!name) return { error: "Give the bid a name." };
  // a new bid says where the work is; it goes in the Telegram message
  if (!id && !text(fd, "location")) return { error: "Write the location: where the work is." };
  const gazette = text(fd, "gazette_url");
  if (gazette && !/^https?:\/\/\S+$/i.test(gazette)) return { error: "The Gazette link should start with https://" };
  const meetingRaw = text(fd, "prebid_meeting_at"), dueRaw = text(fd, "submission_due_at");
  const meeting = localToIso(meetingRaw), due = localToIso(dueRaw);
  if (meetingRaw && !meeting) return { error: "Enter the pre-bid meeting as a date and time." };
  if (dueRaw && !due) return { error: "Enter the submission deadline as a date and time." };
  const papers = text(fd, "papers_due_on");
  if (papers && !/^\d{4}-\d{2}-\d{2}$/.test(papers)) return { error: "Enter when the papers should be ready as a date." };
  const attendance = text(fd, "prebid_attendance");
  if (attendance && attendance !== "optional" && attendance !== "compulsory") return { error: "Attendance is optional or compulsory." };
  const status = text(fd, "status") ?? "registered";
  if (!isBidStatus(status)) return { error: "Unknown stage." };

  const row = {
    name, company: text(fd, "company"), location: text(fd, "location"), gazette_url: gazette, prebid_meeting_at: meeting,
    prebid_attendance: meeting ? attendance : null, papers_due_on: papers, submission_due_at: due, notes: text(fd, "notes"),
  };
  const { s } = w;
  if (!id) {
    const { data, error } = await s.supabase.from("bids").insert({ ...row, status }).select(COLS).single();
    if (error) return { error: dbMessage(error) };
    await s.supabase.from("bid_events").insert({ bid_id: data.id, status });
    refresh(data.id);
    return { ok: true, id: data.id, note: await tell("added", data as Bid, s) };
  }
  const { data: before } = await s.supabase.from("bids").select(COLS).eq("id", id).maybeSingle();
  if (!before) return { error: "That bid no longer exists." };
  const { data, error } = await s.supabase.from("bids").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).select(COLS).single();
  if (error) return { error: dbMessage(error) };
  refresh(id);
  // the group hears about the dates, which go on everyone's calendar; other edits stay quiet
  const moved = before.prebid_meeting_at !== data.prebid_meeting_at || before.submission_due_at !== data.submission_due_at
    || before.prebid_attendance !== data.prebid_attendance;
  return { ok: true, id, note: moved ? await tell("dates", data as Bid, s) : undefined };
}

/** Move a bid to another stage, with an optional note; the group is told. */
export async function setBidStatus(id: string, status: string, note: string | null): Promise<BidResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(id) || !isBidStatus(status)) return { error: "No such bid or stage." };
  const { s } = w;
  const { data, error } = await s.supabase.from("bids").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select(COLS).maybeSingle();
  if (error) return { error: dbMessage(error) };
  if (!data) return { error: "That bid no longer exists." };
  const n = note?.trim() || null;
  await s.supabase.from("bid_events").insert({ bid_id: id, status, note: n });
  refresh(id);
  return { ok: true, id, note: await tell("status", data as Bid, s, n) };
}

/** A note on the bid's history (not sent to the group). */
export async function addBidNote(id: string, note: string): Promise<BidResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(id) || !note.trim()) return { error: "Write the note first." };
  const { error } = await w.s.supabase.from("bid_events").insert({ bid_id: id, note: note.trim() });
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { ok: true, id };
}

/** Remove a bid entered by mistake (admin only); its history goes with it. */
export async function deleteBid(id: string): Promise<BidResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (w.s.role !== "admin") return { error: "Only an admin can delete a bid." };
  if (!isId(id)) return { error: "No such bid." };
  const { error } = await w.s.supabase.from("bids").delete().eq("id", id);
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

/**
 * Post every bid, stage by stage, to the Telegram group with the buttons for the
 * calendar and the list (admin); this also connects the group's commands.
 */
export async function postBidBoard(): Promise<BidResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (w.s.role !== "admin") return { error: "Only an admin can post the board." };
  if (!telegramReady()) return { error: "Telegram is not set up." };
  const h = await headers();
  const hook = await ensureWebhook(h.get("x-forwarded-host") ?? h.get("host"));
  const { data, error } = await w.s.supabase.from("bids").select(COLS);
  if (error) return { error: dbMessage(error) };
  const r = await sendTelegram(stageView((data ?? []) as BoardBid[]), { keyboard: VIEW_KEYS });
  if (!r.ok) return { error: `Telegram did not take it: ${r.error}` };
  return { ok: true, note: hook.ok ? "Posted to the group. The /bids, /calendar and /list commands work there too." : `Posted, but the commands could not be connected: ${hook.error}` };
}
