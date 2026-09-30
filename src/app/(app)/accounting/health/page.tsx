import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { getSession } from "@/server/session";
import { bookLabel } from "@/lib/books";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type Check = { no: number; name: string; ok: boolean; detail: string };

/** The §13 invariants, run on the real books of the book you are in. */
export default async function HealthPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const { data, error } = await s.supabase.rpc("rpc_health_check");
  const checks = (data ?? []) as Check[];
  const failing = checks.filter((c) => !c.ok).length;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Health check"
        subtitle={`The ${bookLabel(s.book)} book, checked ${dateTime(new Date().toISOString())}`}
        action={<Link href="/accounting/health" className="text-sm font-medium text-[var(--brand)] hover:underline">Run again</Link>} />
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error.message}</p>
      ) : (
        <>
          <div className={`rounded-xl border px-5 py-4 ${failing ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
            <p className="font-semibold">{failing ? `${failing} of ${checks.length} checks need attention` : `All ${checks.length} checks pass`}</p>
            <p className="mt-0.5 text-sm">
              {failing ? "The books are internally inconsistent where marked. Nothing is changed by this page; tell the person who looks after the system." : "The ledger balances and every total ties to its source."}
            </p>
          </div>
          <Card>
            <CardHeader title="Checks" />
            <ol className="divide-y divide-[var(--border)]">
              {checks.map((c) => (
                <li key={c.no} className="flex items-start gap-3 px-5 py-3">
                  <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${c.ok ? "bg-emerald-600" : "bg-red-600"}`}>
                    {c.ok ? "✓" : "!"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.no}. {c.name} <span className="sr-only">{c.ok ? "passes" : "fails"}</span></p>
                    <p className="text-xs text-[var(--muted)]">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </div>
  );
}
