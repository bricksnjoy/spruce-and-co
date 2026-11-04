import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { standardGstRate } from "@/server/gst-rate";
import { ProjectForm, type ProjectFormValues } from "../project-form";

export const dynamic = "force-dynamic";

/** A new project; from a won bid (?bid=…) it starts filled in from the bid, as an active project. */
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ bid?: string }> }) {
  const { bid: bidId } = await searchParams;
  const supabase = await createClient();
  const fromBid = bidId && /^[0-9a-f-]{36}$/i.test(bidId);
  const [{ data: customers }, { data: code }, gstRate, { data: bid }] = await Promise.all([
    supabase.from("contacts").select("id, name").contains("kinds", ["customer"]).eq("active", true).order("name"),
    supabase.rpc("next_project_code"),
    standardGstRate(supabase),
    fromBid ? supabase.from("bids").select("id, name, company, location, notes, project_id").eq("id", bidId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // the bid's company is the customer when one goes by that name
  const customer = bid?.company ? (customers ?? []).find((c) => c.name.trim().toLowerCase() === bid.company!.trim().toLowerCase()) : undefined;
  const values: ProjectFormValues = bid ? {
    name: bid.name, status: "in_progress", site_address: bid.location, description: bid.notes, customer_id: customer?.id ?? null,
  } : {};

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2">
        <Link href={bid ? `/bids/${bid.id}` : "/projects"} className="text-xs text-[var(--muted)] hover:underline">
          ← {bid ? "Bid" : "Projects"}
        </Link>
      </div>
      <PageHeader title="New project" subtitle={bid ? `From the won bid "${bid.name}"${bid.company && !customer ? ` · add ${bid.company} as the customer if they are not one yet` : ""}` : "Everything here can be changed later"} />
      <Card className="p-6">
        <ProjectForm
          mode="create"
          customers={customers ?? []}
          nextCode={(code as string | null) ?? undefined}
          gstRate={gstRate}
          values={values}
          bidId={bid && !bid.project_id ? bid.id : undefined}
        />
      </Card>
    </div>
  );
}
