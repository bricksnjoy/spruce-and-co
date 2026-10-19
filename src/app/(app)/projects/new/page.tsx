import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { ProjectForm } from "../project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const [{ data: customers }, { data: code }] = await Promise.all([
    supabase.from("contacts").select("id, name").contains("kinds", ["customer"]).eq("active", true).order("name"),
    supabase.rpc("next_project_code"),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2">
        <Link href="/projects" className="text-xs text-[var(--muted)] hover:underline">
          ← Projects
        </Link>
      </div>
      <PageHeader title="New project" subtitle="Everything here can be changed later" />
      <Card className="p-6">
        <ProjectForm
          mode="create"
          customers={customers ?? []}
          nextCode={(code as string | null) ?? undefined}
        />
      </Card>
    </div>
  );
}
