import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Stat, Badge, Progress, Table, Th, Td, Button } from "@/components/ui";
import { money, num } from "@/lib/format";
import type { ProjectPnl } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("project_pnl").select("*").order("code");

  const projects = (data ?? []) as ProjectPnl[];
  const live = projects.filter((p) => p.status === "in_progress");
  const value = projects.reduce((s, p) => s + num(p.value) + num(p.variation), 0);
  const exp = projects.reduce((s, p) => s + num(p.exp), 0);

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Every job, with its live cost position"
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

      <Card>
        {projects.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-[var(--muted)]">No projects yet.</p>
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
