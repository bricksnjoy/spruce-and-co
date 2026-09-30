import { redirect } from "next/navigation";
import { Card, CardHeader, PageHeader, Table, Th, Td } from "@/components/ui";
import { getSession } from "@/server/session";
import { date, money, today } from "@/lib/format";
import { SettingsTabs, SharedNote } from "../tabs";
import { AddRate, AddBrackets, RemoveRate } from "./rate-forms";

export const dynamic = "force-dynamic";

type Rate = { id: string; kind: string; code: string; value: string | null; brackets: Bracket[] | null; effective_from: string };
type Bracket = { from: string | number; to: string | number | null; rate: string | number };

/** The rate in force today is the latest one that has started. */
function current(rows: Rate[], t: string) {
  return rows.filter((r) => r.effective_from <= t).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
}

function History({ rows, t, canEdit }: { rows: Rate[]; t: string; canEdit: boolean }) {
  const cur = current(rows, t);
  const sorted = [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  if (!sorted.length) return null;
  return (
    <Table>
      <thead><tr><Th>From</Th><Th>Rate</Th><Th right>Status</Th></tr></thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.id}>
            <Td>{date(r.effective_from)}</Td>
            <Td>
              {r.brackets ? (
                <ul className="space-y-0.5 text-xs tabular-nums">
                  {r.brackets.map((b, i) => (
                    <li key={i}>
                      {b.to == null ? `Above ${money(Number(b.from))}` : `${money(Number(b.from))} – ${money(Number(b.to))}`}: <strong>{String(Number(b.rate))}%</strong>
                    </li>
                  ))}
                </ul>
              ) : <span className="tabular-nums">{String(Number(r.value))}%</span>}
            </Td>
            <Td right>
              {r.effective_from > t ? (
                <span className="inline-flex items-center gap-2 text-xs text-[var(--muted)]">From {date(r.effective_from)}{canEdit && <RemoveRate id={r.id} />}</span>
              ) : r.id === cur?.id ? <span className="text-xs font-medium text-emerald-700">In force</span>
                : <span className="text-xs text-[var(--muted)]">Replaced</span>}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function TaxesPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data: rates }, { data: codes }] = await Promise.all([
    s.supabase.from("rates").select("id, kind, code, value, brackets, effective_from").order("effective_from"),
    s.supabase.from("tax_codes").select("id, code, name, kind, rate_code, active").order("code"),
  ]);
  const all = (rates ?? []) as Rate[];
  const t = today();
  const of = (kind: string, code = "default") => all.filter((r) => r.kind === kind && r.code === code);
  const canEdit = s.role === "admin";
  const wht = of("wht");

  const simple = (title: string, subtitle: string, kind: string, code = "default") => (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <History rows={of(kind, code)} t={t} canEdit={canEdit} />
      {canEdit && <AddRate kind={kind} code={code} />}
    </Card>
  );

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <PageHeader title="Settings" subtitle="Tax rates are dated: a change is a new rate from the day it starts" />
        <SettingsTabs active="/settings/taxes" />
        <SharedNote />
        {!canEdit && <p className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted)]">Only an admin can add rates.</p>}
      </div>

      <Card>
        <CardHeader title="Tax codes" subtitle="Chosen on each sales and purchase line" />
        <Table>
          <thead><tr><Th>Code</Th><Th>Name</Th><Th right>Rate today</Th></tr></thead>
          <tbody>
            {(codes ?? []).map((c) => {
              const r = c.rate_code ? current(of("gst", c.rate_code), t) : undefined;
              return (
                <tr key={c.id}>
                  <Td className="font-mono text-xs">{c.code}</Td>
                  <Td>{c.name}</Td>
                  <Td right>{c.rate_code ? (r ? `${Number(r.value)}%` : "—") : "No GST"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {simple("GST — standard rate", "Charged on standard-rated sales and claimed on purchases", "gst", "STD")}
      {simple("Pension — employee", "Deducted from pensionable pay of Maldivian staff", "pension_employee")}
      {simple("Pension — employer", "Paid by the company on the same pay", "pension_employer")}

      <Card>
        <CardHeader title="Employee withholding tax" subtitle="Monthly brackets on taxable pay" />
        {!wht.length && (
          <p className="mx-5 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            Not set yet. Payroll will not run until the brackets are entered.
          </p>
        )}
        <History rows={wht} t={t} canEdit={canEdit} />
        {canEdit && <AddBrackets kind="wht" />}
      </Card>

      <Card>
        <CardHeader title="Business profit tax" subtitle="Yearly brackets on taxable profit" />
        <History rows={of("bpt")} t={t} canEdit={canEdit} />
        {canEdit && <AddBrackets kind="bpt" />}
      </Card>
    </div>
  );
}
