import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { money, pct } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";
import { STAGE_LABEL, type ProjectFigures } from "@/lib/project-figures";
import { RunWip } from "./run-wip";

export const dynamic = "force-dynamic";

const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v)));
const sum = (rows: ProjectFigures[], k: keyof ProjectFigures) => rows.reduce((t, r) => t + dbToLaari(r[k] as number), 0n);

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const showArchived = (await searchParams).archived === "1";
  const { data, error } = await s.supabase.from("project_list_v").select("*").order("code");
  const all = (data ?? []) as ProjectFigures[];
  const rows = all.filter((p) => Boolean(p.archived_at) === showArchived);
  const archivedCount = all.filter((p) => p.archived_at).length;
  const hasPoc = all.some((p) => p.recognition_method === "poc");

  return (
    <div className="max-w-7xl space-y-5">
      <PageHeader title="Projects"
        subtitle={showArchived ? "Archived projects: still on the books, out of the working lists" : `${bookLabel(s.book)} book · every figure from the ledger`}
        action={canWrite(s.role) ? <Button href="/projects/new">+ New project</Button> : undefined} />
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">{error.message}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Contract value", sum(rows, "revised"), "Including approved variations"],
          ["Billed", sum(rows, "billed"), `${money(laariToNumber(sum(rows, "remaining_to_bill")))} left to bill`],
          ["Cost to date", sum(rows, "cost_to_date"), "Direct job costs"],
          ["Forecast profit", sum(rows, "forecast_profit"), "Contract value less forecast final cost"],
        ].map(([label, v, hint]) => (
          <Card key={label as string} className="px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label as string}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{money(laariToNumber(v as bigint))}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{hint as string}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {canWrite(s.role) && hasPoc ? <RunWip /> : <span />}
        <Link href={showArchived ? "/projects" : "/projects?archived=1"} className="text-xs text-[var(--muted)] hover:underline">
          {showArchived ? "← Current projects" : `Archived (${archivedCount})`}
        </Link>
      </div>

      <Card>
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-[var(--muted)]">
            {showArchived ? "No archived projects." : "No projects yet."}
            {!showArchived && canWrite(s.role) && <div className="mt-4"><Button href="/projects/new">+ New project</Button></div>}
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Project</Th><Th>Stage</Th><Th right>Contract value</Th><Th right>Billed</Th><Th right>Collected</Th>
                <Th right>Cost</Th><Th right>Forecast profit</Th><Th right>Margin</Th><Th right>Client owes</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-[var(--hover)]">
                  <Td>
                    <Link href={`/projects/${p.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">{p.name}</Link>
                    <p className="text-xs text-[var(--muted)]"><span className="font-mono">{p.code}</span>{p.customer_name ? ` · ${p.customer_name}` : ""}</p>
                  </Td>
                  <Td className="text-xs">{STAGE_LABEL[p.stage] ?? p.stage}</Td>
                  <Td right>{m(p.revised)}</Td>
                  <Td right>{m(p.billed)}<p className="text-xs text-[var(--muted)]">{pct(Number(p.billed_pct), 0)}</p></Td>
                  <Td right>{m(p.collected)}</Td>
                  <Td right>{m(p.cost_to_date)}</Td>
                  <Td right className={dbToLaari(p.forecast_profit) < 0n ? "text-red-700" : ""}>{m(p.forecast_profit)}</Td>
                  <Td right>{pct(Number(p.margin_pct), 1)}</Td>
                  <Td right>{dbToLaari(p.client_balance) !== 0n ? m(p.client_balance) : <span className="text-[var(--muted)]">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
