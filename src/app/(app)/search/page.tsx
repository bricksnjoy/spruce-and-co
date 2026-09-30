import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { getSession } from "@/server/session";
import { date, money, titleize } from "@/lib/format";
import { dbToLaari, laariToNumber, moneyToDb } from "@/lib/money";
import { bookLabel } from "@/lib/books";
import { txnHref } from "@/server/reports/common";

export const dynamic = "force-dynamic";

/** Global search (§9): documents by number, reference or amount; customers, vendors, projects, employees and accounts by name. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  if (!q) return <div className="max-w-5xl"><PageHeader title="Search" subtitle="Type a document number, a name or an amount in the search box" /></div>;
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const amount = /\d/.test(q) ? moneyToDb(q) : null;
  const docCols = "id, type, number, date, total, balance, contact_id, voided_at";
  const [byNo, byRef, byAmt, byTotal, contacts, projects, employees, accounts] = await Promise.all([
    s.supabase.from("document_balances_v").select(docCols).ilike("number", like).limit(25),
    s.supabase.from("transactions").select("id").ilike("reference", like).limit(25),
    amount ? s.supabase.from("transactions").select("id").eq("total_amount", amount).limit(25) : Promise.resolve({ data: [] }),
    amount ? s.supabase.from("document_balances_v").select(docCols).eq("total", amount).limit(25) : Promise.resolve({ data: [] }),
    s.supabase.from("contacts").select("id, name, kinds").ilike("name", like).order("name").limit(20),
    s.supabase.from("projects").select("id, code, name").or(`code.ilike.${like.replace(/[,()]/g, "")},name.ilike.${like.replace(/[,()]/g, "")}`).limit(20),
    s.canPayroll ? s.supabase.from("employees").select("id, name, job_title").ilike("name", like).limit(20) : Promise.resolve({ data: [] }),
    s.supabase.from("accounts").select("id, code, name").or(`code.ilike.${like.replace(/[,()]/g, "")},name.ilike.${like.replace(/[,()]/g, "")}`).limit(20),
  ]);
  const extraIds = [...(byRef.data ?? []), ...(byAmt.data ?? [])].map((r) => r.id);
  const { data: extra } = extraIds.length ? await s.supabase.from("document_balances_v").select(docCols).in("id", extraIds) : { data: [] };
  type D = { id: string; type: string; number: string | null; date: string; total: number; balance: number; contact_id: string | null; voided_at: string | null };
  const docs = new Map<string, D>();
  for (const d of [...(byNo.data ?? []), ...(byTotal.data ?? []), ...(extra ?? [])] as D[]) docs.set(d.id, d);
  const names = new Map((contacts.data ?? []).map((c) => [c.id, c.name]));
  const missing = [...docs.values()].map((d) => d.contact_id).filter((x): x is string => !!x && !names.has(x));
  if (missing.length) for (const c of (await s.supabase.from("contacts").select("id, name").in("id", missing)).data ?? []) names.set(c.id, c.name);
  const list = [...docs.values()].sort((a, b) => b.date.localeCompare(a.date));
  const m = (v: number) => money(laariToNumber(dbToLaari(v)));
  const nothing = !list.length && !(contacts.data ?? []).length && !(projects.data ?? []).length && !(employees.data ?? []).length && !(accounts.data ?? []).length;

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader title={`Search: ${q}`} subtitle={`${bookLabel(s.book)} book`} />
      {nothing && <Card><Empty message="Nothing matches. Try part of a number, a name, or an exact amount." /></Card>}
      {list.length > 0 && (
        <Card>
          <CardHeader title="Documents" />
          <Table>
            <thead><tr><Th>Date</Th><Th>Document</Th><Th>Name</Th><Th right>Total</Th><Th right>Open</Th></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className={d.voided_at ? "text-[var(--muted)] line-through" : ""}>
                  <Td className="whitespace-nowrap">{date(d.date)}</Td>
                  <Td><Link href={txnHref(d.type, d.id)} className="text-[var(--brand)] hover:underline">{titleize(d.type)} {d.number ?? ""}</Link></Td>
                  <Td>{names.get(d.contact_id ?? "") ?? ""}</Td>
                  <Td right>{m(d.total)}</Td><Td right>{Number(d.balance) ? m(d.balance) : ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {(contacts.data ?? []).length > 0 && (
          <Card><CardHeader title="Customers, vendors and partners" />
            <ul className="divide-y divide-[var(--border)] text-sm">
              {(contacts.data ?? []).map((c) => {
                const k = c.kinds as string[];
                const href = k.includes("customer") ? `/sales/customers/${c.id}` : k.includes("vendor") ? `/expenses/vendors/${c.id}` : `/partners/${c.id}`;
                return <li key={c.id} className="flex justify-between px-5 py-2"><Link href={href} className="text-[var(--brand)] hover:underline">{c.name}</Link><span className="text-xs text-[var(--muted)]">{k.join(", ")}</span></li>;
              })}
            </ul></Card>
        )}
        {(projects.data ?? []).length > 0 && (
          <Card><CardHeader title="Projects" />
            <ul className="divide-y divide-[var(--border)] text-sm">
              {(projects.data ?? []).map((p) => <li key={p.id} className="px-5 py-2"><Link href={`/projects/${p.id}`} className="text-[var(--brand)] hover:underline"><span className="font-mono text-xs">{p.code}</span> {p.name}</Link></li>)}
            </ul></Card>
        )}
        {(employees.data ?? []).length > 0 && (
          <Card><CardHeader title="Employees" />
            <ul className="divide-y divide-[var(--border)] text-sm">
              {(employees.data ?? []).map((e) => <li key={e.id} className="flex justify-between px-5 py-2"><Link href={`/payroll/employees/${e.id}`} className="text-[var(--brand)] hover:underline">{e.name}</Link><span className="text-xs text-[var(--muted)]">{e.job_title ?? ""}</span></li>)}
            </ul></Card>
        )}
        {(accounts.data ?? []).length > 0 && (
          <Card><CardHeader title="Accounts" />
            <ul className="divide-y divide-[var(--border)] text-sm">
              {(accounts.data ?? []).map((a) => <li key={a.id} className="px-5 py-2"><Link href={`/accounting/chart/${a.id}`} className="text-[var(--brand)] hover:underline">{a.code} {a.name}</Link></li>)}
            </ul></Card>
        )}
      </div>
    </div>
  );
}
