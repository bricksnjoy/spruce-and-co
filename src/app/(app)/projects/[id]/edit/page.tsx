import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { ProjectForm } from "../../project-form";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: customers }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("contacts").select("id, name").contains("kinds", ["customer"]).eq("active", true).order("name"),
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
          customers={customers ?? []}
          values={{
            id: project.id,
            code: project.code,
            name: project.name,
            customer_id: project.customer_id,
            status: project.status,
            description: project.description,
            site_address: project.site_address,
            contract_value: Number(project.contract_value),
            gst_amount: Number(project.gst_amount),
            start_date: project.start_date,
            duration_days: project.duration_days,
            progress_pct: Number(project.progress_pct),
            recognition_method: project.recognition_method,
          }}
        />
      </Card>
    </div>
  );
}
