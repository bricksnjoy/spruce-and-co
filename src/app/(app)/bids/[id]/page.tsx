import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { BidFormButton } from "@/components/bids/bid-form";
import { DeleteBid, NoteForm, StageControl } from "@/components/bids/bid-controls";
import { BID_STATUS_LABEL, BID_STATUS_TONE, isBidStatus, when, type Bid } from "@/lib/bids";
import { dateTime } from "@/lib/format";
import { telegramReady } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** One bid: its details, its stage, and everything that has happened to it. */
export default async function BidPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ data }, { data: events }] = await Promise.all([
    s.supabase.from("bids").select("id, name, company, location, gazette_url, status, prebid_meeting_at, prebid_attendance, submission_due_at, notes, project_id").eq("id", id).maybeSingle(),
    s.supabase.from("bid_events").select("id, status, note, created_at, profiles:created_by(full_name, email)").eq("bid_id", id).order("created_at", { ascending: false }),
  ]);
  if (!data) notFound();
  const b = data as Bid;
  const writer = canWrite(s.role) && s.book === "live";

  return (
    <div className="max-w-5xl">
      <Link href="/bids" className="text-xs text-[var(--muted)] hover:underline">← Bids</Link>
      <PageHeader title={b.name} subtitle={b.company ?? undefined}
        action={writer ? (
          <div className="flex items-center gap-3">
            {s.role === "admin" && <DeleteBid id={b.id} />}
            <BidFormButton bid={b} className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--hover)]" />
          </div>
        ) : undefined} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Stage" subtitle={telegramReady() ? "Each change is posted to the Telegram group" : "Telegram is not set up yet, so the group is not told"} />
            <div className="px-5 py-4">
              {writer && !b.location && <p className="mb-3 text-xs text-amber-700">No location yet: press Edit to add it, so the Telegram message says where the work is.</p>}
              {writer ? <StageControl id={b.id} status={b.status} />
                : <span className={`rounded-full px-3 py-1 text-xs font-medium ${BID_STATUS_TONE[b.status]}`}>{BID_STATUS_LABEL[b.status]}</span>}
            </div>
          </Card>

          <Card>
            <CardHeader title="History" />
            <div className="space-y-3 px-5 py-4">
              {writer && <NoteForm id={b.id} />}
              <ol className="space-y-3">
                {(events ?? []).map((e) => {
                  const who = e.profiles as unknown as { full_name: string | null; email: string | null } | null;
                  return (
                    <li key={e.id} className="border-l-2 border-[var(--border)] pl-3 text-sm">
                      {e.status && isBidStatus(e.status) && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BID_STATUS_TONE[e.status]}`}>{BID_STATUS_LABEL[e.status]}</span>
                      )}
                      {e.note && <p className="mt-1 whitespace-pre-line">{e.note}</p>}
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{dateTime(e.created_at)}{who ? ` · ${who.full_name || who.email}` : ""}</p>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Details" />
          <dl className="space-y-3 px-5 py-4 text-sm">
            <Row k="Company">{b.company ?? "—"}</Row>
            <Row k="Location">{b.location ?? "—"}</Row>
            <Row k="Gazette">{b.gazette_url ? <a href={b.gazette_url} target="_blank" rel="noreferrer" className="break-all text-[var(--brand)] hover:underline">Open the notice ↗</a> : "—"}</Row>
            <Row k="Pre-bid meeting">
              {b.prebid_meeting_at ? <>{when(b.prebid_meeting_at)}{b.prebid_attendance && <span className={`ml-1 rounded px-1.5 text-[11px] ${b.prebid_attendance === "compulsory" ? "bg-red-50 text-red-700" : "bg-[var(--hover)]"}`}>{b.prebid_attendance}</span>}</> : "—"}
            </Row>
            <Row k="Submission deadline">{b.submission_due_at ? when(b.submission_due_at) : "—"}</Row>
            {b.notes && <Row k="Notes"><span className="whitespace-pre-line">{b.notes}</span></Row>}
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{k}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
