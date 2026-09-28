import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Stat, Badge, Progress, Table, Th, Td, Button } from "@/components/ui";
import { money, num } from "@/lib/format";
import type { ProjectPnl } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const showArchived = (await searchParams).archived === "1";
  const supabase = await createClient();
  const [{ data }, { data: archivedRows }] = await Promise.all([
    supabase.from("project_pnl").select("*").order("code"),
    supabase.from("projects").select("id").not("archived_at", "is", null),
  ]);
  const archivedIds = new Set((archivedRows ?? []).map((r) => r.id));

  const projects = ((data ?? []) as ProjectPnl[]).filter((p) => archivedIds.has(p.id) === showArchived);
  const live = projects.filter((p) => p.status === "in_progress");
  const value = projects.reduce((s, p) => s + num(p.value) + num(p.variation), 0);
  const exp = projects.reduce((s, p) => s + num(p.exp), 0);

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={showArchived ? "Archived projects: still on the books, out of the working lists" : "Every job, with its live cost position"}
        action={<Button href="/projects/new">+ New project</Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total projects" value={String(projects.length)} hint={`${live.length} in progress`} />
        <Stat label="Project value" value={money(value)} hint="Including variations" />
        <Stat label="Cost to date" value={money(exp)} />
        <Stat
          label="Profit"
          value={money(projects.reduce((s, p) => s + num(p.profit), 0))}
          tone="good"
        />
      </div>

      <div className="mb-3 flex justify-end text-xs">
        <Link href={showArchived ? "/projects" : "/projects?archived=1"} className="text-[var(--muted)] hover:underline">
          {showArchived ? "← Back to current projects" : `Archived (${archivedIds.size})`}
        </Link>
      </div>

      <Card>
        {projects.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-[var(--muted)]">{showArchived ? "No archived projects." : "No projects yet."}</p>
            <div className="mt-4"><Button href="/projects/new">+ New project</Button></div>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Project</Th>
                <Th>Client</Th>
                <Th>Status</Th>
                <Th>Progress</Th>
                <Th right>Value</Th>
                <Th right>Variation</Th>
                <Th right>EXP</Th>
                <Th right>Profit</Th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const profit = num(p.profit);
                return (
                  <tr key={p.id} className="hover:bg-[var(--hover)]">
                    <Td className="font-mono text-xs text-[var(--muted)]">{p.code}</Td>
                    <Td>
                      <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                        {p.project_name}
                      </Link>
                    </Td>
                    <Td>{p.client_name ?? "—"}</Td>
                    <Td><Badge value={p.status} /></Td>
                    <Td><Progress value={num(p.progress_pct)} /></Td>
                    <Td right>{money(p.value)}</Td>
                    <Td right className={num(p.variation) ? "text-[var(--accent)]" : "text-[var(--muted)]"}>
                      {num(p.variation) ? money(p.variation) : "—"}
                    </Td>
                    <Td right>{money(p.exp)}</Td>
                    <Td right className={profit >= 0 ? "text-emerald-700" : "text-red-700"}>
                      {money(profit)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
