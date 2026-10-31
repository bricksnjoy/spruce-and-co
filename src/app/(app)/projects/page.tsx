import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession } from "@/server/session";
import { date, money, pct } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { bookLabel } from "@/lib/books";
import { STAGE_LABEL, STAGE_TONE, type ProjectFigures } from "@/lib/project-figures";
import { PurgeProjectButton, RestoreProjectButton } from "@/components/projects/restore-project";
import { RunWip } from "./run-wip";

export const dynamic = "force-dynamic";

const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v)));
const sum = (rows: ProjectFigures[], k: keyof ProjectFigures) => rows.reduce((t, r) => t + dbToLaari(r[k] as number), 0n);
const STAGES = ["active", "completed", "settled", "closed"] as const;
type Stage = (typeof STAGES)[number];
type Deleted = { id: string; code: string; name: string; customer_name: string | null; deleted_at: string; deleted_by: string | null; documents: number };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ stage?: string; archived?: string; deleted?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const admin = s.role === "admin";
  const stage = STAGES.find((k) => k === sp.stage);
  const view = sp.deleted === "1" && admin ? "deleted" : sp.archived === "1" ? "archived" : stage ?? "all";
  const [{ data, error }, { data: deletedData }] = await Promise.all([
    s.supabase.from("project_list_v").select("*").order("code"),
    admin ? s.supabase.rpc("deleted_projects") : Promise.resolve({ data: [] }),
  ]);
  const all = (data ?? []) as ProjectFigures[];
  const deleted = (deletedData ?? []) as Deleted[];
  const current = all.filter((p) => !p.archived_at);
  const archived = all.filter((p) => p.archived_at);
  const rows = view === "archived" ? archived : stage ? current.filter((p) => p.stage === stage) : current;
  const hasPoc = all.some((p) => p.recognition_method === "poc");

  return (
    <div className="max-w-7xl space-y-5">
      <PageHeader title="Projects"
        subtitle={view === "deleted" ? "Deleted projects are kept for 30 days; restoring one puts it back with all its documents, financing and profit split."
          : view === "archived" ? "Archived projects: still on the books, out of the working lists"
          : `${bookLabel(s.book)} book · every figure from the ledger`}
        action={canWrite(s.role) ? <Button href="/projects/new">+ New project</Button> : undefined} />
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">{error.message}</p>}

      {view !== "deleted" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Contract value", sum(rows, "revised"), "Including approved variations"],
            ["Billed", sum(rows, "billed"), `${money(laariToNumber(sum(rows, "remaining_to_bill")))} left to bill`],
            ["Cost to date", sum(rows, "cost_to_date"), "Direct job costs"],
            ["Forecast profit", sum(rows, "forecast_profit"), "Contract value less forecast final cost"],
          ].map(([label, v, hint]) => (
            <Card key={label as string} className="stat px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label as string}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{money(laariToNumber(v as bigint))}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{hint as string}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectFilter view={view} admin={admin} counts={{
          all: current.length, archived: archived.length, deleted: deleted.length,
          ...Object.fromEntries(STAGES.map((k) => [k, current.filter((p) => p.stage === k).length])) as Record<Stage, number>,
        }} />
        {canWrite(s.role) && hasPoc && view !== "deleted" && <RunWip />}
      </div>

      {view === "deleted" ? <DeletedProjects rows={deleted} /> : (
        <Card className="overflow-hidden">
          {rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-[var(--muted)]">
              {view === "archived" ? "No archived projects." : stage ? `No ${STAGE_LABEL[stage].split(" ·")[0].toLowerCase()} projects.` : "No projects yet."}
              {view === "all" && canWrite(s.role) && <div className="mt-4"><Button href="/projects/new">+ New project</Button></div>}
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th aria-hidden className="w-2 border-b border-[var(--border)] p-0" />
                  <Th>Project</Th><Th right>Contract value</Th><Th right>Billed</Th><Th right>Collected</Th>
                  <Th right>Cost</Th><Th right>Forecast profit</Th><Th right>Margin</Th><Th right>Client owes</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="row-link hover:bg-[var(--hover)]">
                    {/* the stage, as a strip of its colour down the left side of the row */}
                    <td title={STAGE_LABEL[p.stage]} className={`w-2 border-b border-[var(--border)] p-0 ${STAGE_TONE[p.stage]?.bar ?? STAGE_TONE.closed.bar}`}>
                      <span className="sr-only">{STAGE_LABEL[p.stage]}</span>
                    </td>
                    <Td>
                      <Link href={`/projects/${p.id}`} className="row-link-main font-medium hover:text-[var(--brand)] hover:underline">{p.name}</Link>
                      <p className="text-xs text-[var(--muted)]"><span className="font-mono">{p.code}</span>{p.customer_name ? ` · ${p.customer_name}` : ""}</p>
                    </Td>
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
      )}
    </div>
  );
}

/** One filter for the list: all current projects, one stage (with its colour), archived, or (admin) deleted. */
function ProjectFilter({ view, admin, counts }: {
  view: string; admin: boolean; counts: Record<Stage | "all" | "archived" | "deleted", number>;
}) {
  const options: { key: string; href: string; label: string; dot?: string; gap?: boolean }[] = [
    { key: "all", href: "/projects", label: "All" },
    ...STAGES.map((k) => ({ key: k, href: `/projects?stage=${k}`, label: STAGE_LABEL[k], dot: STAGE_TONE[k].bar })),
    { key: "archived", href: "/projects?archived=1", label: "Archived", gap: true },
    ...(admin ? [{ key: "deleted", href: "/projects?deleted=1", label: "Deleted" }] : []),
  ];
  return (
    <nav aria-label="Filter projects" className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 text-xs">
      {options.map((o) => {
        const on = o.key === view;
        return (
          <span key={o.key} className="contents">
            {o.gap && <span aria-hidden className="mx-1 h-5 w-px bg-[var(--border)]" />}
            <Link href={o.href} aria-current={on ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 transition-colors ${
                on ? "bg-[var(--brand)] font-medium text-white" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}>
              {o.dot && <span aria-hidden className={`h-2 w-2 rounded-full ${o.dot}`} />}
              {o.label}
              <span className={`tabular-nums ${on ? "text-white/70" : "opacity-70"}`}>{counts[o.key as keyof typeof counts]}</span>
            </Link>
          </span>
        );
      })}
    </nav>
  );
}

/** Projects deleted in the last 30 days, each with everything it had, ready to restore (admin). */
function DeletedProjects({ rows }: { rows: Deleted[] }) {
  return (
    <Card>
      {rows.length === 0 ? <div className="px-5 py-12 text-center text-sm text-[var(--muted)]">No deleted projects.</div> : (
        <Table>
          <thead><tr><Th>Project</Th><Th>Deleted</Th><Th>By</Th><Th right>Documents</Th><Th>Restore until</Th><Th><span className="sr-only">Restore</span></Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><span className="font-medium">{r.name}</span>
                  <p className="text-xs text-[var(--muted)]"><span className="font-mono">{r.code}</span>{r.customer_name ? ` · ${r.customer_name}` : ""}</p></Td>
                <Td className="whitespace-nowrap">{date(r.deleted_at.slice(0, 10))}</Td>
                <Td>{r.deleted_by ?? "—"}</Td>
                <Td right>{r.documents}</Td>
                <Td className="whitespace-nowrap">{date(new Date(new Date(r.deleted_at).getTime() + 30 * 86400000).toISOString().slice(0, 10))}</Td>
                <Td right><span className="inline-flex items-center justify-end gap-1"><RestoreProjectButton id={r.id} /><PurgeProjectButton id={r.id} code={r.code} /></span></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
