import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import type { BankRule } from "@/lib/bank-rules";
import { RuleActions, RuleForm } from "@/components/banking/rules";

export const dynamic = "force-dynamic";
const DIR = { in: "Money in", out: "Money out", any: "In or out" } as const;

/** Rules suggest what a statement line was for; you still confirm each one before it is added. */
export default async function RulesPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data: rules }, { data: accts }, { data: contacts }, { data: projects }] = await Promise.all([
    s.supabase.from("bank_rules").select("*").order("priority").order("created_at"),
    s.supabase.from("accounts").select("id, code, name").eq("active", true).is("contact_id", null).order("code"),
    s.supabase.from("contacts").select("id, name").eq("active", true).order("name"),
    s.supabase.from("projects").select("id, code").is("archived_at", null).order("code"),
  ]);
  const acct = new Map((accts ?? []).map((a) => [a.id, `${a.code} · ${a.name}`]));
  const contact = new Map((contacts ?? []).map((c) => [c.id, c.name]));
  const project = new Map((projects ?? []).map((p) => [p.id, p.code]));
  const amt = (v: BankRule["min_amount"]) => money(laariToNumber(dbToLaari(v ?? 0)));
  const writer = canWrite(s.role);

  return (
    <div className="max-w-6xl space-y-5">
      <Link href="/banking" className="text-xs text-[var(--muted)] hover:underline">← Banking</Link>
      <PageHeader title="Bank rules" subtitle="When a statement line fits a rule, the Add form is filled in for you. Rules are shared by the Live and Test books." />
      <Card>
        {(rules ?? []).length === 0 ? <Empty message="No rules yet." /> : (
          <Table>
            <thead><tr><Th>Rule</Th><Th>When</Th><Th>Posts to</Th><Th right>Priority</Th><Th right> </Th></tr></thead>
            <tbody>
              {((rules ?? []) as BankRule[]).map((r) => (
                <tr key={r.id} className={r.active ? "" : "opacity-50"}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td className="text-xs text-[var(--muted)]">
                    {[DIR[r.direction], r.contains && `contains “${r.contains}”`, r.min_amount != null && `from ${amt(r.min_amount)}`, r.max_amount != null && `up to ${amt(r.max_amount)}`].filter(Boolean).join(" · ")}
                  </Td>
                  <Td className="text-xs">{[acct.get(r.account_id), r.contact_id && contact.get(r.contact_id), r.project_id && project.get(r.project_id)].filter(Boolean).join(" · ")}</Td>
                  <Td right>{r.priority}</Td>
                  <Td right>{writer && <RuleActions id={r.id} active={r.active} />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {writer && <Card><CardHeader title="New rule" /><RuleForm accounts={accts ?? []} contacts={contacts ?? []} projects={projects ?? []} /></Card>}
    </div>
  );
}
