import { redirect } from "next/navigation";
import { Badge, Card, CardHeader, PageHeader, Table, Th, Td } from "@/components/ui";
import { DeleteScheme, SchemeForm } from "@/components/partners/forms";
import { getSession } from "@/server/session";
import { date, today } from "@/lib/format";
import { SettingsTabs, SharedNote } from "../tabs";

export const dynamic = "force-dynamic";

type Alloc = { party_type: string; contact_id: string | null; percent: string; sort_order: number; contacts: { name: string } | null };
type Scheme = { id: string; name: string; effective_from: string; scheme_allocations: Alloc[] };
const party = (a: Alloc) => a.party_type === "financing_pool" ? "Investors (financing pool)" : a.party_type === "company" ? "Company (retained)" : a.contacts?.name ?? "—";

/** Profit-share schemes (§5): versioned by start date, each totalling 100%; a project uses the one in force when it starts (P6). */
export default async function ProfitSharePage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data }, { data: partners }, { data: used }, { data: split }] = await Promise.all([
    s.supabase.from("profit_schemes").select("id, name, effective_from, scheme_allocations(party_type, contact_id, percent, sort_order, contacts(name))").order("effective_from", { ascending: false }),
    s.supabase.from("contacts").select("id, name").contains("kinds", ["partner"]).eq("active", true).order("name"),
    s.supabase.from("projects").select("scheme_id"),
    s.supabase.from("distributions").select("scheme_id"),
  ]);
  const schemes = (data ?? []) as unknown as Scheme[];
  const t = today();
  const current = schemes.find((x) => x.effective_from <= t);
  const count = (rows: { scheme_id: string | null }[] | null, id: string) => (rows ?? []).filter((r) => r.scheme_id === id).length;
  const prefill: Record<string, string> = {};
  for (const a of current?.scheme_allocations ?? []) prefill[a.party_type === "financing_pool" ? "pool" : a.party_type === "company" ? "company" : a.contact_id!] = String(Number(a.percent));
  const isAdmin = s.role === "admin";

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" subtitle="Profit-share schemes" />
      <SettingsTabs active="/settings/profit-share" />
      <SharedNote />
      <div className="space-y-5">
        {schemes.map((x) => (
          <Card key={x.id}>
            <CardHeader title={x.name} subtitle={`Projects starting from ${date(x.effective_from)} · ${count(used, x.id)} project(s) · ${count(split, x.id) ? "used in a split" : "not used in a split yet"}`}
              action={<div className="flex items-center gap-3">{x.id === current?.id && <Badge value="active" />}{isAdmin && !count(split, x.id) && schemes.length > 1 && <DeleteScheme id={x.id} />}</div>} />
            <Table>
              <thead><tr><Th>Party</Th><Th right>Share</Th></tr></thead>
              <tbody>
                {[...x.scheme_allocations].sort((a, b) => a.sort_order - b.sort_order).map((a, i) => (
                  <tr key={i}><Td>{party(a)}</Td><Td right>{String(Number(a.percent))}%</Td></tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ))}
        {isAdmin ? (
          <Card>
            <CardHeader title="Add a version" subtitle="Applies to projects that start on or after its date and have not been split yet. A version that has been used in a split is never changed." />
            <SchemeForm partners={partners ?? []} current={prefill} />
          </Card>
        ) : <p className="text-sm text-[var(--muted)]">Only an admin can add a scheme version.</p>}
      </div>
    </div>
  );
}
