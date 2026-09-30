import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { JournalForm } from "@/components/accounting/journal-form";
import { canWrite, getSession } from "@/server/session";
import { bookLabel } from "@/lib/books";

export const dynamic = "force-dynamic";

export default async function NewJournalPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!canWrite(s.role)) redirect("/accounting/journal");
  const opening = (await searchParams).type === "opening_balance";
  const [{ data: accounts }, { data: contacts }, { data: projects }] = await Promise.all([
    s.supabase.from("accounts").select("id, code, name").eq("active", true).order("code"),
    s.supabase.from("contacts").select("id, name").eq("active", true).order("name"),
    s.supabase.from("projects").select("id, code, name").order("code"),
  ]);
  return (
    <div className="max-w-6xl space-y-5">
      <div><Link href="/accounting/journal" className="text-xs text-[var(--muted)] hover:underline">← Journal entries</Link></div>
      <PageHeader title={opening ? "Opening balances" : "New journal entry"} subtitle={`${bookLabel(s.book)} book`} />
      <Card>
        <CardHeader title={opening ? "Balances on the day the new books start" : "Debits and credits"}
          subtitle={opening ? "One line per account balance. Customer and vendor balances need the name so their statements are right. Any difference goes to Opening Balance Equity." : "Debits must equal credits. Payroll accounts need payroll permission."} />
        <JournalForm opening={opening}
          accounts={(accounts ?? []).map((a) => ({ id: a.id, name: `${a.code} ${a.name}` }))}
          contacts={contacts ?? []} projects={(projects ?? []).map((p) => ({ id: p.id, name: `${p.code} ${p.name}` }))} />
      </Card>
    </div>
  );
}
