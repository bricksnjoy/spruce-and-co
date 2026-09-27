import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { ProjectForm } from "../../project-form";
import { DeleteProject } from "./delete-project";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: project }, { data: clients }, { count: bills }, { data: me }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("bills").select("id", { count: "exact", head: true }).eq("project_id", id),
    supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle(),
  ]);

  if (!project) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2">
        <Link href={`/projects/${id}`} className="text-xs text-[var(--muted)] hover:underline">
          ← {project.name}
        </Link>
      </div>
      <PageHeader title="Edit project" subtitle={project.code} />
      <Card className="p-6">
        <ProjectForm
          mode="edit"
          clients={clients ?? []}
          values={{
            id: project.id,
            code: project.code,
            name: project.name,
            client_id: project.client_id,
            status: project.status,
            description: project.description,
            site_address: project.site_address,
            contract_value: Number(project.contract_value),
            gst_amount: Number(project.gst_amount),
            start_date: project.start_date,
            duration_days: project.duration_days,
            progress_pct: Number(project.progress_pct),
          }}
        />
      </Card>
      {me?.role === "admin" && (
        <Card className="mt-6 border-red-200 p-6">
          <h2 className="mb-2 text-sm font-semibold text-red-800">Delete project</h2>
          <DeleteProject id={project.id} code={project.code} bills={bills ?? 0} />
        </Card>
      )}
    </div>
  );
}
