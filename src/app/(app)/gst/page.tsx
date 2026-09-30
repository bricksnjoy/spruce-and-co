import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Stat } from "@/components/ui";
import { moneyExact, num } from "@/lib/format";
import { ScheduleTable, type ScheduleRow } from "./schedule-table";

export const dynamic = "force-dynamic";

export default async function GstPage() {
  const supabase = await createClient();
  const [{ data }, { data: company }] = await Promise.all([
    supabase.from("gst_input_schedule").select("*").order("invoice_date", { ascending: false }),
    supabase.from("company").select("gst_registered").eq("id", true).maybeSingle(),
  ]);

  // Input tax is claimable only by a registered person. Showing a filled-in
  // schedule before then would present money as recoverable when it is
  // simply part of what the materials cost.
  if (!company?.gst_registered) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="GST input schedule" subtitle="Not in use yet" />
        <Card>
          <div className="space-y-3 px-5 py-6 text-sm">
            <p>
              Spruce &amp; Co is not registered for GST, so the GST your suppliers charge
              cannot be claimed back. It is part of what the materials cost, and the project
              figures already treat it that way.
            </p>
            <p className="text-[var(--muted)]">
              Registration becomes compulsory once taxable supplies pass MVR 1 million in a
              12-month period. Every bill photographed between now and then still records its
              GST, so the schedule will have its history the day it is needed.
            </p>
            <p>
              <Link href="/settings/company" className="font-medium text-[var(--brand)] hover:underline">
                Mark the company registered
              </Link>{" "}
              once MIRA issues the taxable activity number, and this page fills itself in.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const rows = (data ?? []) as ScheduleRow[];
  const net = rows.reduce((s, r) => s + num(r.invoice_total_excl_gst), 0);
  const claimable = rows.reduce(
    (s, r) => s + num(r.gst_at_6) + num(r.gst_at_8) + num(r.gst_at_12),
    0,
  );
  const capital = rows.filter((r) => r.expense_class === "capital").length;

  return (
    <div>
      <PageHeader
        title="GST input schedule"
        subtitle="Every project's purchase invoices, by filing quarter, in the MIRA layout"
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Invoices" value={String(rows.length)} hint={`${capital} capital`} />
        <Stat label="Total excl GST" value={moneyExact(net)} />
        <Stat label="Claimable input GST" value={moneyExact(claimable)} tone="good" />
        <Stat
          label="Suppliers without TIN"
          value={String(rows.filter((r) => !r.supplier_tin).length)}
          tone={rows.some((r) => !r.supplier_tin) ? "warn" : "good"}
        />
      </div>

      <ScheduleTable rows={rows} />
    </div>
  );
}
