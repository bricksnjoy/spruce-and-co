import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { salesFormData } from "@/server/sales-data";
import { openInvoices } from "@/server/open-invoices";
import { ApplyForm } from "@/components/sales/apply-form";
import { applyAdvance } from "@/app/actions/sales";
import { NewAdvance } from "@/components/sales/new-advance";
import { money } from "@/lib/format";
import { dbToLaari, laariToDb, laariToNumber } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Client advances (decision B2): money received before work is invoiced, and using it on invoices. */
export default async function Advances() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [data, invoices, { data: acct }] = await Promise.all([salesFormData(s), openInvoices(s), s.supabase.from("accounts").select("id").eq("subtype", "customer_advances").maybeSingle()]);
  const { data: lines } = acct ? await s.supabase.from("journal_lines").select("contact_id, home_debit, home_credit").eq("account_id", acct.id) : { data: [] };
  const held = new Map<string, bigint>();
  for (const l of lines ?? []) if (l.contact_id) held.set(l.contact_id, (held.get(l.contact_id) ?? 0n) + dbToLaari(l.home_credit) - dbToLaari(l.home_debit));
  const rows = data.customers.filter((c) => (held.get(c.id) ?? 0n) !== 0n);
  const writer = canWrite(s.role);
  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/sales" className="text-xs text-[var(--muted)] hover:underline">← Sales</Link>
      <PageHeader title="Client advances" subtitle="Held as Customer Advances until applied to invoices" />
      <Card>
        <CardHeader title="Advances held" />
        {rows.length === 0 ? <Empty message="No advances held." /> : (
          <Table>
            <thead><tr><Th>Customer</Th><Th right>Held</Th></tr></thead>
            <tbody>{rows.map((c) => <tr key={c.id}><Td><Link href={`/sales/customers/${c.id}`} className="hover:underline">{c.name}</Link></Td><Td right>{money(laariToNumber(held.get(c.id)!))}</Td></tr>)}</tbody>
          </Table>
        )}
      </Card>
      {writer && <NewAdvance customers={data.customers} projects={data.projects} banks={data.banks} />}
      {writer && rows.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold">Apply an advance to invoices</h2>
          <ApplyForm mode="advance_application" action={applyAdvance} customers={rows} invoices={invoices} banks={[]}
            advances={Object.fromEntries(rows.map((c) => [c.id, laariToDb(held.get(c.id)!)]))} />
        </div>
      )}
    </div>
  );
}
