import { getSession } from "@/server/session";
import { scheduleCsv, type ScheduleRow } from "@/lib/gst";

/** A return's output or input schedule as a CSV file, for MIRA's schedule templates. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response("Not signed in", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const side = new URL(request.url).searchParams.get("side") === "input" ? "input" : "output";
  const [{ data: p }, { data, error }] = await Promise.all([
    s.supabase.from("tax_periods").select("start_date, end_date").eq("id", id).maybeSingle(),
    s.supabase.rpc("gst_schedule", { p_period: id }),
  ]);
  if (!p || error) return new Response("Not found", { status: 404 });
  return new Response(scheduleCsv((data ?? []) as ScheduleRow[], side), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="gst-${side}-${p.start_date}-to-${p.end_date}.csv"`,
    },
  });
}
