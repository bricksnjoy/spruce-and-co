import { createClient } from "@/lib/supabase/server";
import { buildLedger, ledgerCsv, loadRecords, periodOf } from "@/lib/accounting";
import { filterEntries } from "../filter";

/** The ledger as filtered on the page, as a CSV file. */
export async function GET(request: Request) {
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const period = periodOf(sp);
  const entries = filterEntries(buildLedger(await loadRecords(supabase)), sp, period.from, period.to);
  return new Response(ledgerCsv(entries), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ledger-${period.from}-to-${period.to}.csv"`,
    },
  });
}
