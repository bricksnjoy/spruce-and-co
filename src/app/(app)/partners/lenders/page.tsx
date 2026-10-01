import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Empty, PageHeader, Stat, Table, Th, Td } from "@/components/ui";
import { NewContact } from "@/components/contacts/new-contact";
import { canWrite, getSession } from "@/server/session";
import { money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";

export const dynamic = "force-dynamic";
const m = (v: bigint) => money(laariToNumber(v));

type Row = { id: string; name: string; contact_person: string | null; phone: string | null; email: string | null; needs_review: boolean; kinds: string[] };
const VIEWS: [string, string][] = [["active", "Active"], ["archived", "Archived"]];

/** External lenders: who lent what to which projects, what has been repaid, and what is still owed. */
export default async function LendersPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { view = "active", q } = await searchParams;
  const query = q?.trim() ?? "";
  let req = s.supabase.from("contacts").select("id, name, contact_person, phone, email, needs_review, kinds")
    .contains("kinds", ["lender"]).eq("active", view !== "archived").order("name");
  if (query) req = req.ilike("name", `%${query.replace(/[%_\\]/g, (x) => `\\${x}`)}%`);

  const [{ data: rows }, { data: fin }, { data: returns }] = await Promise.all([
    req,
    s.supabase.from("project_financing_v").select("contact_id, project_id, received, repaid, outstanding").eq("source_type", "external"),
    s.supabase.from("partner_statement_v").select("contact_id, accrued, paid, outstanding").eq("component", "financing_return"),
  ]);
  const list = (rows ?? []) as Row[];
  const sum = <T extends { contact_id: string }>(xs: T[] | null, id: string, k: keyof T) =>
    (xs ?? []).filter((x) => x.contact_id === id).reduce((t, x) => t + dbToLaari(x[k] as number), 0n);
  const per = list.map((r) => ({
    ...r,
    projects: new Set((fin ?? []).filter((f) => f.contact_id === r.id && dbToLaari(f.received) !== 0n).map((f) => f.project_id)).size,
    lent: sum(fin, r.id, "received"), repaid: sum(fin, r.id, "repaid"), principal: sum(fin, r.id, "outstanding"),
    ret: sum(returns, r.id, "outstanding"), retPaid: sum(returns, r.id, "paid"),
  }));
  const total = (k: "lent" | "principal" | "ret") => per.reduce((t, p) => t + p[k], 0n);
  const href = (v: string) => `/partners/lenders?${new URLSearchParams({ view: v, ...(query ? { q: query } : {}) })}`;

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader title="Lenders" subtitle={`External lenders who finance projects · ${bookLabel(s.book)} book`}
        action={<Link href="/partners" className="text-sm font-medium text-[var(--brand)] hover:underline">Partners & financing</Link>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Lent to projects" value={m(total("lent"))} hint="Every loan received from these lenders" />
        <Stat label="Principal owed" value={m(total("principal"))} hint="Loans not yet repaid" />
        <Stat label="Financing return owed" value={m(total("ret"))} hint="Their share of the financing pool, posted but not paid" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {VIEWS.map(([v, l]) => (
            <Link key={v} href={href(v)} className={`rounded-full px-3 py-1 text-xs font-medium ${view === v ? "bg-[var(--brand)] text-white" : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}>{l}</Link>
          ))}
        </div>
        <form className="flex gap-2" action="/partners/lenders">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={query} placeholder="Search lenders" aria-label="Search lenders"
            className="w-56 rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-1.5 text-sm outline-none focus:border-[var(--brand)]" />
        </form>
      </div>

      {canWrite(s.role) && <NewContact kind="lender" base="/partners" singular="lender" />}

      <Card>
        {per.length === 0 ? <Empty message={query ? `No lenders match "${query}".` : "No lenders yet. Press \"New lender\" to add one."} /> : (
          <Table>
            <thead><tr><Th>Lender</Th><Th>Contact</Th><Th right>Projects</Th><Th right>Lent</Th><Th right>Repaid</Th><Th right>Principal owed</Th><Th right>Return owed</Th><Th right>Total owed</Th></tr></thead>
            <tbody>
              {per.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--hover)]">
                  <Td>
                    <Link href={`/partners/${r.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">{r.name}</Link>
                    {r.needs_review && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Needs review</span>}
                    {r.kinds.length > 1 && <span className="ml-2 text-xs text-[var(--muted)]">also {r.kinds.filter((k) => k !== "lender").map((k) => k === "partner" ? "Capital Pool member" : k).join(", ")}</span>}
                  </Td>
                  <Td className="text-xs text-[var(--muted)]">{[r.contact_person, r.phone, r.email].filter(Boolean).join(" · ")}</Td>
                  <Td right>{r.projects || <span className="text-[var(--muted)]">—</span>}</Td>
                  <Td right>{m(r.lent)}</Td>
                  <Td right>{m(r.repaid)}</Td>
                  <Td right>{m(r.principal)}</Td>
                  <Td right>{m(r.ret)}</Td>
                  <Td right className="font-semibold">{m(r.principal + r.ret)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
