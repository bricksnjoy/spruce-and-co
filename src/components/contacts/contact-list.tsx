import Link from "next/link";
import { Card, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, type Session } from "@/server/session";
import { money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";
import type { Side } from "./sides";
import { NewContact } from "./new-contact";

type Row = { id: string; name: string; contact_person: string | null; phone: string | null; email: string | null; needs_review: boolean; active: boolean; kinds: string[] };
type Bal = { contact_id: string; receivable: number; payable: number; overdue_receivable: number; overdue_payable: number };

const VIEWS: [string, string][] = [["active", "Active"], ["review", "Needs review"], ["archived", "Archived"]];

/** Customers or vendors, with what is owed and overdue, from the ledger. */
export async function ContactList({ s, side, view = "active", query = "" }: { s: Session; side: Side; view?: string; query?: string }) {
  let req = s.supabase.from("contacts").select("id, name, contact_person, phone, email, needs_review, active, kinds")
    .contains("kinds", [side.kind]).order("name");
  if (view === "archived") req = req.eq("active", false);
  else req = req.eq("active", true);
  if (view === "review") req = req.eq("needs_review", true);
  if (query) req = req.ilike("name", `%${query.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);

  const [{ data: rows }, { data: bals }] = await Promise.all([
    req,
    s.supabase.from("contact_balances_v").select("contact_id, receivable, payable, overdue_receivable, overdue_payable"),
  ]);
  const byId = new Map<string, Bal>(((bals ?? []) as Bal[]).map((b) => [b.contact_id, b]));
  const list = (rows ?? []) as Row[];
  const owed = (id: string) => dbToLaari(byId.get(id)?.[side.owedKey]);
  const overdue = (id: string) => dbToLaari(byId.get(id)?.[side.overdueKey]);
  const totalOwed = list.reduce((t, r) => t + owed(r.id), 0n);
  const totalOverdue = list.reduce((t, r) => t + overdue(r.id), 0n);
  const reviewCount = view === "active" ? list.filter((r) => r.needs_review).length : 0;
  const href = (v: string) => `${side.base}?${new URLSearchParams({ view: v, ...(query ? { q: query } : {}) })}`;

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader title={side.title} subtitle={`${bookLabel(s.book)} book · balances from the ledger`} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{side.owedLabel}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{money(laariToNumber(totalOwed))}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Overdue</p>
          <p className={`mt-2 text-2xl font-semibold tabular-nums ${totalOverdue > 0n ? "text-red-700" : ""}`}>{money(laariToNumber(totalOverdue))}</p>
        </Card>
      </div>

      {reviewCount > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {reviewCount} {reviewCount === 1 ? `${side.singular} was` : `${side.title.toLowerCase()} were`} copied from the old lists and not yet confirmed as real.{" "}
          <Link href={href("review")} className="font-medium underline">Review them</Link>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {VIEWS.map(([v, l]) => (
            <Link key={v} href={href(v)} className={`rounded-full px-3 py-1 text-xs font-medium ${view === v ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}>{l}</Link>
          ))}
        </div>
        <form className="flex gap-2" action={side.base}>
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={query} placeholder={`Search ${side.title.toLowerCase()}`} aria-label={`Search ${side.title.toLowerCase()}`}
            className="w-56 rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-1.5 text-sm outline-none focus:border-[var(--brand)]" />
        </form>
      </div>

      {canWrite(s.role) && <NewContact kind={side.kind} base={side.base} singular={side.singular} />}

      <Card>
        {list.length === 0 ? <Empty message={query ? `No ${side.title.toLowerCase()} match "${query}".` : `No ${side.title.toLowerCase()} here yet.`} /> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Contact</Th><Th right>{side.owedLabel}</Th><Th right>Overdue</Th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--hover)]">
                  <Td>
                    <Link href={`${side.base}/${r.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">{r.name}</Link>
                    {r.needs_review && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Needs review</span>}
                    {r.kinds.length > 1 && <span className="ml-2 text-xs text-[var(--muted)]">also {r.kinds.filter((k) => k !== side.kind).join(", ")}</span>}
                  </Td>
                  <Td className="text-xs text-[var(--muted)]">{[r.contact_person, r.phone, r.email].filter(Boolean).join(" · ")}</Td>
                  <Td right>{owed(r.id) !== 0n ? money(laariToNumber(owed(r.id))) : <span className="text-[var(--muted)]">—</span>}</Td>
                  <Td right>{overdue(r.id) > 0n ? <span className="text-red-700">{money(laariToNumber(overdue(r.id)))}</span> : <span className="text-[var(--muted)]">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
