import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { addDays } from "@/lib/documents";
import { quotationLines, type EstimateInput, type EstimateResult } from "@/lib/estimator";
import { QuotationForm } from "../quotation-form";
import { formData } from "../form-data";
import { today } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; estimate?: string }>;
}) {
  const { project: projectParam, estimate: estimateId } = await searchParams;
  const supabase = await createClient();
  // the form's lists and, if made from a cabinet estimate, its lines — all at once
  const [{ templates, kit, projects, clients }, { data: est }] = await Promise.all([
    formData(supabase),
    estimateId
      ? supabase.from("cabinet_estimates").select("id, name, project_id, inputs, result").eq("id", estimateId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const template = templates[0];
  const estLines = est ? quotationLines(est.inputs as EstimateInput, est.result as EstimateResult) : null;
  const projectId = projectParam ?? est?.project_id ?? undefined;
  const todayIso = today();

  // started from a project: it arrives already addressed to that project's client
  const project = projects.find((p) => p.id === projectId);
  const client = clients.find((c) => c.id === project?.client_id);

  return (
    <div>
      <div className="mb-2">
        <Link href={project ? `/projects/${project.id}` : "/quotations"} className="text-xs text-[var(--muted)] hover:underline">
          ← {project ? project.name : "Quotations"}
        </Link>
      </div>
      <PageHeader title="New quotation" subtitle="It gets its number when saved" />
      {!template ? (
        <p className="text-sm text-[var(--muted)]">
          Set up a quotation template first, under <Link href="/quotations/templates" className="underline">Templates</Link>.
        </p>
      ) : (
        <QuotationForm templates={templates} projects={projects} clients={clients} kit={kit} number={null}
          initial={{
            template_id: template.id,
            project_id: project?.id ?? null,
            client_id: client?.id ?? null,
            to_name: client?.name ?? "",
            to_details: client ? [client.phone, client.address].filter(Boolean).join("\n") : "",
            title: project?.name ?? est?.name ?? "",
            issue_date: todayIso,
            valid_until: template.body.valid_days ? addDays(todayIso, template.body.valid_days) : null,
            duration: "",
            signatory_id: template.tail.signatory_id || kit.signatories[0]?.id || null,
            show_stamp: template.tail.show_stamp,
            tax_rate: template.body.tax_rate,
            terms: template.tail.terms,
            notes: "",
            items: estLines?.length
              ? estLines.map((l) => ({ title: l.title, description: l.description, unit: l.unit, qty: l.qty, rate: l.rate }))
              : [{ title: "", description: "", unit: "Nos", qty: 1, rate: 0 }],
            estimate_id: est?.id ?? null,
          }} />
      )}
    </div>
  );
}
