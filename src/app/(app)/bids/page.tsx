import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Empty, PageHeader, Stat, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { BidFormButton } from "@/components/bids/bid-form";
import { BID_STATUSES, BID_STATUS_LABEL, BID_STATUS_TONE, OPEN_BID, when, type Bid, type BidStatus } from "@/lib/bids";

export const dynamic = "force-dynamic";

/** Tenders the company is chasing, newest dates first, with where each one stands. */
export default async function BidsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { status: filter } = await searchParams;
  const { data } = await s.supabase.from("bids")
    .select("id, name, company, gazette_url, status, prebid_meeting_at, prebid_attendance, submission_due_at, notes, project_id")
    .order("submission_due_at", { ascending: true, nullsFirst: false });
  const bids = (data ?? []) as Bid[];
  const now = new Date().toISOString();
  const open = bids.filter((b) => OPEN_BID.includes(b.status));
  const won = bids.filter((b) => b.status === "won").length;
  const decided = won + bids.filter((b) => b.status === "lost").length;
  const dueSoon = open.filter((b) => b.submission_due_at && b.submission_due_at >= now
    && Date.parse(b.submission_due_at) - Date.parse(now) < 7 * 86400_000).length;
  const shown = BID_STATUSES.includes(filter as BidStatus) ? bids.filter((b) => b.status === filter)
    : filter === "all" ? bids : open;
  const tab = (key: string, text: string, n: number) => (
    <Link key={key} href={key === "open" ? "/bids" : `/bids?status=${key}`}
      className={`rounded-full px-3 py-1 text-xs font-medium ${(filter ?? "open") === key ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"}`}>
      {text} <span className="opacity-70">{n}</span>
    </Link>
  );

  return (
    <div>
      <PageHeader title="Bids" subtitle="Tenders from registering to won or lost; dates go on the calendar and the Telegram group hears each step"
        action={canWrite(s.role) && s.book === "live" ? <BidFormButton className="rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--brand-hover)]" /> : undefined} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open bids" value={String(open.length)} />
        <Stat label="Due in the next 7 days" value={String(dueSoon)} tone={dueSoon ? "warn" : "default"} />
        <Stat label="Won" value={String(won)} tone={won ? "good" : "default"} />
        <Stat label="Win rate" value={decided ? `${Math.round((won / decided) * 100)}%` : "—"} hint={`${decided} decided`} />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {tab("open", "Open", open.length)}
        {BID_STATUSES.map((st) => tab(st, BID_STATUS_LABEL[st], bids.filter((b) => b.status === st).length))}
        {tab("all", "All", bids.length)}
      </div>

      <Card>
        {shown.length === 0 ? <Empty message={bids.length ? "No bids at this stage." : "No bids yet. Use “+ New bid” to add the first."} /> : (
          <Table>
            <thead><tr><Th>Bid</Th><Th>Stage</Th><Th>Pre-bid meeting</Th><Th>Submission deadline</Th><Th>{""}</Th></tr></thead>
            <tbody>
              {shown.map((b) => {
                const late = OPEN_BID.includes(b.status) && b.submission_due_at && b.submission_due_at < now;
                return (
                  <tr key={b.id} className="row-link hover:bg-[var(--hover)]">
                    <Td>
                      <Link href={`/bids/${b.id}`} className="row-link-main font-medium hover:text-[var(--brand)] hover:underline">{b.name}</Link>
                      {b.company && <span className="block text-xs text-[var(--muted)]">{b.company}</span>}
                    </Td>
                    <Td><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BID_STATUS_TONE[b.status]}`}>{BID_STATUS_LABEL[b.status]}</span></Td>
                    <Td className="text-xs">
                      {b.prebid_meeting_at ? <>{when(b.prebid_meeting_at)}{b.prebid_attendance && <span className="block text-[var(--muted)]">{b.prebid_attendance}</span>}</> : "—"}
                    </Td>
                    <Td className={`text-xs ${late ? "font-medium text-red-700" : ""}`}>{b.submission_due_at ? when(b.submission_due_at) : "—"}{late && <span className="block">passed</span>}</Td>
                    <Td className="text-xs">{b.gazette_url ? <a href={b.gazette_url} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline">Gazette ↗</a> : null}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
