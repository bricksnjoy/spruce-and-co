import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DocumentSheet } from "@/components/document-sheet";
import { loadQuotation } from "@/lib/document-loaders";
import { PrintToolbar } from "../../toolbar";

export const dynamic = "force-dynamic";

export default async function PrintQuotation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const doc = await loadQuotation(supabase, id);
  if (!doc) notFound();
  return (
    <>
      <title>{doc.q.number}</title>
      <PrintToolbar back={`/quotations/${id}`} filename={`${doc.q.number.replace(/[\\/]+/g, "-")}${doc.q.title ? ` ${doc.q.title}` : ""}`} />
      <DocumentSheet header={doc.template.header} body={doc.template.body} tail={doc.template.tail}
        signer={doc.signer} company={doc.kit.company} data={doc.sheet} />
    </>
  );
}
