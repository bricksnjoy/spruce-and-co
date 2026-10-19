import type { createClient } from "@/lib/supabase/server";
import { round2, signerFor, toTemplate, type DocKind, type Template } from "@/lib/documents";
import { signingKit } from "@/lib/branding";
import type { SheetData } from "@/components/document-sheet";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The template a document was made with, or that kind's default if it has since gone. */
async function templateFor(supabase: Supabase, kind: DocKind, id: string | null): Promise<Template | null> {
  if (id) {
    const { data } = await supabase.from("document_templates").select("*").eq("id", id).maybeSingle();
    if (data) return toTemplate(data);
  }
  const { data } = await supabase
    .from("document_templates")
    .select("*")
    .eq("kind", kind)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toTemplate(data) : null;
}

export async function loadQuotation(supabase: Supabase, id: string) {
  const [{ data: q }, { data: items }] = await Promise.all([
    supabase.from("quotations").select("*, projects(id, code, name)").eq("id", id).maybeSingle(),
    supabase.from("quotation_items").select("*").eq("quotation_id", id).order("sort_order"),
  ]);
  if (!q) return null;
  const template = await templateFor(supabase, "quotation", q.template_id);
  if (!template) return null;
  const kit = await signingKit(supabase);
  const signer = signerFor(kit, template.tail, q.signatory_id, q.show_stamp);

  const lines = (items ?? []).map((l) => {
    const qty = Number(l.qty);
    const rate = Number(l.rate);
    return { title: l.title, description: l.description, unit: l.unit, qty, rate, amount: round2(qty * rate) };
  });
  const sheet: SheetData = {
    kind: "quotation",
    number: q.number,
    date: q.issue_date,
    untilDate: q.valid_until,
    duration: q.duration,
    toName: q.to_name,
    toDetails: q.to_details,
    title: q.title,
    lines,
    taxRate: Number(q.tax_rate),
    terms: q.terms ?? "",
  };
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const project = q.projects as unknown as { id: string; code: string; name: string } | null;
  return { q, project, template, signer, kit, sheet, subtotal };
}
