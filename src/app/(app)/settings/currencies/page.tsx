import { redirect } from "next/navigation";
import { Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { getSession, canWrite } from "@/server/session";
import { date } from "@/lib/format";
import { SettingsTabs, SharedNote } from "../tabs";
import { AddCurrency, AddExchangeRate, CurrencyToggle } from "./currency-forms";

export const dynamic = "force-dynamic";

export default async function CurrenciesPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ data: currencies }, { data: rates }] = await Promise.all([
    s.supabase.from("currencies").select("code, name, active").order("code"),
    s.supabase.from("exchange_rates").select("currency, rate_date, rate").order("rate_date", { ascending: false }).limit(60),
  ]);
  const foreign = (currencies ?? []).filter((c) => c.code !== "MVR");
  const latest = new Map<string, { rate_date: string; rate: number }>();
  for (const r of rates ?? []) if (!latest.has(r.currency)) latest.set(r.currency, r);
  const isAdmin = s.role === "admin";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <PageHeader title="Settings" subtitle="Currencies and exchange rates" />
        <SettingsTabs active="/settings/currencies" />
        <SharedNote />
      </div>

      <Card>
        <CardHeader title="Currencies" subtitle="MVR is the home currency; every report is in MVR" />
        <Table>
          <thead><tr><Th>Code</Th><Th>Name</Th><Th right>Latest rate</Th><Th right>In use</Th></tr></thead>
          <tbody>
            {(currencies ?? []).map((c) => {
              const l = latest.get(c.code);
              return (
                <tr key={c.code}>
                  <Td className="font-mono text-xs">{c.code}</Td>
                  <Td>{c.name}</Td>
                  <Td right>{c.code === "MVR" ? "Home" : l ? `${Number(l.rate)} MVR · ${date(l.rate_date)}` : <span className="text-amber-700">No rate yet</span>}</Td>
                  <Td right>{c.code === "MVR" ? "Always" : <CurrencyToggle code={c.code} active={c.active} canEdit={isAdmin} />}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {isAdmin && <AddCurrency />}
      </Card>

      <Card>
        <CardHeader title="Exchange rates" subtitle="MVR for one unit, by day. A document uses the rate on its date." />
        {canWrite(s.role) && foreign.length > 0 && <AddExchangeRate currencies={foreign.filter((c) => c.active).map((c) => c.code)} />}
        {(rates ?? []).length === 0 ? <Empty message="No exchange rates recorded yet." /> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Currency</Th><Th right>MVR per unit</Th></tr></thead>
            <tbody>
              {(rates ?? []).map((r) => (
                <tr key={`${r.currency}-${r.rate_date}`}>
                  <Td>{date(r.rate_date)}</Td>
                  <Td className="font-mono text-xs">{r.currency}</Td>
                  <Td right>{Number(r.rate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
