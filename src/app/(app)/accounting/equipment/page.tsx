import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { date, money, today } from "@/lib/format";
import { loadRecords } from "@/lib/accounting";
import { assetValue } from "@/lib/statements";
import { AccountingTabs } from "../nav";
import { AssetForm, AssetRow, type AssetView } from "./equipment-client";

export const dynamic = "force-dynamic";

export default async function EquipmentPage() {
  const supabase = await createClient();
  const [records, { data: company }, { data: full }] = await Promise.all([
    loadRecords(supabase),
    supabase.from("company").select("asset_life_years").eq("id", true).maybeSingle(),
    supabase.from("assets").select("*").order("purchased_on", { ascending: false }),
  ]);
  const now = today();
  const life = Number(company?.asset_life_years ?? 5);
  const bills = new Map(records.bills.map((b) => [b.id, b]));
  const vendor = (b: (typeof records.bills)[number]) => (b.vendors as unknown as { name: string } | null)?.name ?? "Supplier";

  const assets: AssetView[] = (full ?? []).map((a) => {
    const bill = a.bill_id ? bills.get(a.bill_id) : undefined;
    // an item bought on a bill costs what the bill says
    const cost = bill ? Number(bill.total) : Number(a.cost);
    const purchased = bill?.issue_date ?? a.purchased_on;
    const v = assetValue({ purchased_on: purchased, cost, life_years: Number(a.life_years), disposed_on: a.disposed_on }, now);
    return {
      id: a.id,
      name: a.name,
      category: a.category,
      purchased_on: purchased,
      cost,
      life_years: Number(a.life_years),
      bill_id: a.bill_id,
      bill_label: bill ? `${vendor(bill)}${bill.bill_no ? ` ${bill.bill_no}` : ""}` : null,
      disposed_on: a.disposed_on,
      disposal_amount: a.disposal_amount === null ? null : Number(a.disposal_amount),
      serial_no: a.serial_no,
      location: a.location,
      note: a.note,
      depreciation: v.depreciation,
      value: v.value,
      monthly: v.monthly,
    };
  });
  const registered = new Set(assets.map((a) => a.bill_id).filter(Boolean));
  const unregistered = records.bills
    .filter((b) => b.expense_class === "capital" && !registered.has(b.id) && b.status !== "void" && b.status !== "draft")
    .map((b) => ({ id: b.id, label: `${vendor(b)}${b.bill_no ? ` ${b.bill_no}` : ""} · ${b.description ?? ""}`.trim(), date: b.issue_date ?? b.created_at.slice(0, 10), total: Number(b.total), description: b.description }));
  const inUse = assets.filter((a) => !a.disposed_on);
  const cost = inUse.reduce((s, a) => s + a.cost, 0);
  const value = inUse.reduce((s, a) => s + a.value, 0);
  const yearDep = assets.reduce((s, a) => s + (a.disposed_on && a.disposed_on < `${now.slice(0, 4)}-01-01` ? 0 : a.monthly * 12), 0);

  return (
    <div>
      <PageHeader title="Accounting" subtitle="Tools, machines and vehicles the company owns" />
      <AccountingTabs active="/accounting/equipment" />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Items in use" value={String(inUse.length)} hint={`${assets.length - inUse.length} sold or scrapped`} />
        <Stat label="Cost" value={money(cost)} hint="of items in use" />
        <Stat label="Value today" value={money(value)} hint="cost less depreciation" />
        <Stat label="Depreciation a year" value={money(yearDep)} hint="straight line over each item's life" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Register" subtitle="Click an item to edit it, or to record that it was sold or scrapped" />
            <ul className="divide-y divide-[var(--border)]">
              {assets.map((a) => <AssetRow key={a.id} a={a} />)}
              {!assets.length && <li className="px-5 py-10 text-center text-sm text-[var(--muted)]">Nothing in the register yet.</li>}
            </ul>
          </Card>
          {unregistered.length > 0 && (
            <Card>
              <CardHeader title="Equipment bills not in the register" subtitle="Bills marked as equipment. Add each one so its life and any sale are recorded; until then it is written off over the default life." />
              <ul className="divide-y divide-[var(--border)] text-sm">
                {unregistered.map((b) => (
                  <li key={b.id} className="px-5 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-xs text-[var(--muted)]">{date(b.date)}</span>
                      <span className="min-w-0 flex-1 truncate">{b.label}</span>
                      <span className="tabular-nums">{money(b.total)}</span>
                    </div>
                    <AssetForm compact bill={{ id: b.id, date: b.date, total: b.total, name: b.description ?? "" }} life={life} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="Add an item" subtitle="Bought without a bill in the app, or before it was used" />
          <AssetForm life={life} />
        </Card>
      </div>
    </div>
  );
}
