"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  docNumber,
  portionLines,
  round2,
  toTemplate,
  INVOICE_STATUSES,
  QUOTE_STATUSES,
  type DocKind,
  type InvoiceStatus,
  type QuoteStatus,
  type TemplateBody,
  type TemplateHeader,
  type TemplateTail,
} from "@/lib/documents";
import { today } from "@/lib/format";

export type DocResult = { error?: string; ok?: boolean; id?: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

const fmt = (n: number) =>
  new Intl.NumberFormat("en-MV", { style: "currency", currency: "MVR" }).format(n);

function refresh(projectId?: string | null) {
  revalidatePath("/quotations", "layout");
  revalidatePath("/invoices", "layout");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

async function signedIn(supabase: Supabase) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

function parse<T>(fd: FormData, key = "payload"): T | null {
  try {
    return JSON.parse(String(fd.get(key) ?? "")) as T;
  } catch {
    return null;
  }
}

/** The next number in a kind's run, e.g. the 39th quotation. */
async function nextSeq(supabase: Supabase, table: "quotations" | "invoices") {
  const { data } = await supabase.from(table).select("seq").order("seq", { ascending: false }).limit(1);
  return (data?.[0]?.seq ?? 0) + 1;
}

async function defaultTemplate(supabase: Supabase, kind: DocKind) {
  const { data } = await supabase
    .from("document_templates")
    .select("*")
    .eq("kind", kind)
    .order("is_default", { ascending: false })
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data ? toTemplate(data) : null;
}

/* ─────────────────────────── templates ─────────────────────────── */

export async function saveTemplate(_prev: unknown, fd: FormData): Promise<DocResult> {
  const supabase = await createClient();
  if (!(await signedIn(supabase))) return { error: "Not signed in." };

  const t = parse<{
    id: string;
    name: string;
    header: TemplateHeader;
    body: TemplateBody;
    tail: TemplateTail;
  }>(fd);
  if (!t?.id) return { error: "Nothing to save." };
  if (!t.name?.trim()) return { error: "Give the template a name." };
  if (!t.header?.number_prefix?.trim()) return { error: "Set how its numbers start, e.g. SC-Q/{YY}/." };

  const { error } = await supabase
    .from("document_templates")
    .update({
      name: t.name.trim(),
      header: t.header,
      body: { ...t.body, tax_rate: Number(t.body.tax_rate) || 0 },
      tail: t.tail,
      updated_at: new Date().toISOString(),
    })
    .eq("id", t.id);
  if (error) return { error: error.message };

  refresh();
  return { ok: true };
}

/** A new template starts as a copy of that kind's default, ready to change. */
export async function createTemplate(kind: DocKind) {
  const supabase = await createClient();
  const user = await signedIn(supabase);
  if (!user) return;
  const base = await defaultTemplate(supabase, kind);

  const { data } = await supabase
    .from("document_templates")
    .insert({
      kind,
      name: `New ${kind} template`,
      is_default: !base,
      header: base?.header ?? {},
      body: base?.body ?? {},
      tail: base?.tail ?? {},
      created_by: user.id,
    })
    .select("id")
    .single();

  refresh();
  if (data) redirect(`/quotations/templates/${data.id}`);
}

export async function setDefaultTemplate(id: string): Promise<DocResult> {
  const supabase = await createClient();
  const { data: t } = await supabase.from("document_templates").select("kind").eq("id", id).maybeSingle();
  if (!t) return { error: "That template no longer exists." };

  await supabase.from("document_templates").update({ is_default: false }).eq("kind", t.kind).eq("is_default", true);
  const { error } = await supabase.from("document_templates").update({ is_default: true }).eq("id", id);
  if (error) return { error: error.message };

  refresh();
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<DocResult> {
  const supabase = await createClient();
  const { data: t } = await supabase.from("document_templates").select("is_default").eq("id", id).maybeSingle();
  if (t?.is_default) return { error: "Make another template the default before removing this one." };
  // documents made with it keep their own copy of the terms, so nothing is lost
  const { error } = await supabase.from("document_templates").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  redirect("/quotations/templates");
}

/* ─────────────────────────── quotations ─────────────────────────── */

export interface LineInput {
  title: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
}

export interface QuotationInput {
  id?: string;
  template_id: string | null;
  project_id: string | null;
  client_id: string | null;
  to_name: string;
  to_details: string;
  title: string;
  issue_date: string;
  valid_until: string | null;
  duration: string;
  signatory_id: string | null;
  show_stamp: boolean;
  tax_rate: number;
  terms: string;
  notes: string;
  items: LineInput[];
  /** the cabinet estimate this quotation was made from */
  estimate_id?: string | null;
}

async function invoiceCount(supabase: Supabase, quotationId: string) {
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("quotation_id", quotationId)
    .neq("status", "cancelled");
  return count ?? 0;
}

export async function saveQuotation(_prev: unknown, fd: FormData): Promise<DocResult> {
  const supabase = await createClient();
  const user = await signedIn(supabase);
  if (!user) return { error: "Not signed in." };

  const q = parse<QuotationInput>(fd);
  if (!q) return { error: "Nothing to save." };
  if (!q.to_name?.trim()) return { error: "Who is the quotation for?" };
  const items = (q.items ?? [])
    .map((l) => ({
      title: l.title?.trim() || null,
      description: l.description?.trim() || null,
      unit: l.unit?.trim() || null,
      qty: Number(l.qty) || 0,
      rate: Number(l.rate) || 0,
    }))
    .filter((l) => l.title || l.description || l.rate);
  if (!items.length) return { error: "Add at least one line of work." };

  const fields = {
    template_id: q.template_id || null,
    project_id: q.project_id || null,
    client_id: q.client_id || null,
    to_name: q.to_name.trim(),
    to_details: q.to_details?.trim() || null,
    title: q.title?.trim() || null,
    issue_date: q.issue_date || today(),
    valid_until: q.valid_until || null,
    duration: q.duration?.trim() || null,
    signatory_id: q.signatory_id || null,
    show_stamp: q.show_stamp !== false,
    tax_rate: Number(q.tax_rate) || 0,
    terms: q.terms ?? "",
    notes: q.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  let id = q.id;
  let oldProject: string | null = null;
  if (id) {
    if (await invoiceCount(supabase, id)) {
      return { error: "This quotation has invoices raised from it, so it can no longer be changed." };
    }
    const { data: old } = await supabase.from("quotations").select("project_id").eq("id", id).maybeSingle();
    oldProject = old?.project_id ?? null;
    const { error } = await supabase.from("quotations").update(fields).eq("id", id);
    if (error) return { error: error.message };
    await supabase.from("quotation_items").delete().eq("quotation_id", id);
  } else {
    const template = fields.template_id
      ? toTemplate(
          (await supabase.from("document_templates").select("*").eq("id", fields.template_id).single()).data!,
        )
      : await defaultTemplate(supabase, "quotation");
    // two people saving at once can reach for the same number; the second tries the next
    for (let attempt = 0; attempt < 3 && !id; attempt++) {
      const seq = await nextSeq(supabase, "quotations");
      const { data, error } = await supabase
        .from("quotations")
        .insert({
          ...fields,
          seq,
          number: docNumber(
            template?.header.number_prefix ?? "SC-Q/{YY}/",
            seq,
            fields.issue_date,
            template?.header.number_pad ?? 2,
          ),
          created_by: user.id,
        })
        .select("id")
        .single();
      if (data) id = data.id;
      else if (error?.code !== "23505") return { error: error?.message ?? "Could not save." };
    }
    if (!id) return { error: "Could not number the quotation — try again." };
  }

  const { error: iErr } = await supabase
    .from("quotation_items")
    .insert(items.map((l, i) => ({ ...l, quotation_id: id, sort_order: i })));
  if (iErr) return { error: iErr.message };

  if (q.estimate_id) {
    await supabase.from("cabinet_estimates").update({ quotation_id: id }).eq("id", q.estimate_id);
    revalidatePath("/estimator");
  }

  refresh(fields.project_id);
  if (oldProject && oldProject !== fields.project_id) refresh(oldProject);
  redirect(`/quotations/${id}`);
}

export async function setQuotationStatus(id: string, status: QuoteStatus): Promise<DocResult> {
  if (!QUOTE_STATUSES.includes(status)) return { error: "Unknown status." };
  const supabase = await createClient();
  const { data: q } = await supabase
    .from("quotations")
    .select("status, project_id")
    .eq("id", id)
    .maybeSingle();
  if (!q) return { error: "That quotation no longer exists." };

  if (q.status === "won" && status !== "won" && (await invoiceCount(supabase, id))) {
    return { error: "Invoices have been raised from this quotation — cancel them first." };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("quotations")
    .update({
      status,
      status_changed_at: now,
      won_at: status === "won" ? now : null,
      updated_at: now,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  // winning the quote wins the job, if the project was still being chased
  if (status === "won" && q.project_id) {
    await supabase
      .from("projects")
      .update({ status: "won" })
      .eq("id", q.project_id)
      .in("status", ["lead", "tendering"]);
  }

  refresh(q.project_id);
  return { ok: true };
}

export async function deleteQuotation(id: string): Promise<DocResult> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("quotation_id", id);
  if (count) return { error: "Invoices were raised from this quotation, so it has to stay on record." };
  const { data: q } = await supabase.from("quotations").select("project_id").eq("id", id).maybeSingle();
  const { error } = await supabase.from("quotations").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh(q?.project_id);
  redirect("/quotations");
}

/* ─────────────────────────── invoices ─────────────────────────── */

/**
 * Raise an invoice from a won quotation, for a percentage of it (a 70%
 * advance, the 30% balance) or a set amount. Together the invoices can never
 * bill more than was quoted.
 */
export async function convertToInvoice(_prev: unknown, fd: FormData): Promise<DocResult> {
  const supabase = await createClient();
  const user = await signedIn(supabase);
  if (!user) return { error: "Not signed in." };

  const quotationId = String(fd.get("quotation_id") ?? "");
  const basis = String(fd.get("basis") ?? "percent") === "amount" ? "amount" : "percent";
  const value = Number(String(fd.get("value") ?? "").replace(/[^0-9.]/g, ""));
  const issueDate = String(fd.get("issue_date") ?? "") || today();
  const dueDate = String(fd.get("due_date") ?? "") || null;
  const templateId = String(fd.get("template_id") ?? "") || null;
  const label = String(fd.get("label") ?? "").trim();
  const signatoryId = String(fd.get("signatory_id") ?? "") || null;
  const showStamp = fd.get("show_stamp") === "on";

  if (!Number.isFinite(value) || value <= 0) {
    return { error: basis === "percent" ? "Enter the percentage to invoice." : "Enter the amount to invoice." };
  }

  const [{ data: q }, { data: lines }, { data: totals }] = await Promise.all([
    supabase.from("quotations").select("*").eq("id", quotationId).maybeSingle(),
    supabase.from("quotation_items").select("*").eq("quotation_id", quotationId).order("sort_order"),
    supabase.from("quotation_totals").select("subtotal, invoiced").eq("quotation_id", quotationId).maybeSingle(),
  ]);
  if (!q) return { error: "That quotation no longer exists." };
  if (q.status !== "won") return { error: "Only a won quotation can be invoiced." };

  const subtotal = Number(totals?.subtotal ?? 0);
  const remaining = round2(subtotal - Number(totals?.invoiced ?? 0));
  if (subtotal <= 0) return { error: "This quotation has nothing to invoice." };

  const target = round2(basis === "percent" ? (subtotal * value) / 100 : value);
  const pct = basis === "percent" ? value : (target / subtotal) * 100;
  if (target > remaining + 0.005) {
    return {
      error: `Only ${fmt(remaining)} (${((remaining / subtotal) * 100).toFixed(2).replace(/\.00$/, "")}%) of this quotation is left to invoice.`,
    };
  }

  const template = templateId
    ? toTemplate((await supabase.from("document_templates").select("*").eq("id", templateId).single()).data!)
    : await defaultTemplate(supabase, "invoice");

  const pctLabel = `${Number(pct.toFixed(2))}%`;
  const suffix = label || (pct >= 99.995 ? "" : pctLabel);

  let id: string | undefined;
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    const seq = await nextSeq(supabase, "invoices");
    const { data, error } = await supabase
      .from("invoices")
      .insert({
        seq,
        number: docNumber(
          template?.header.number_prefix ?? "SC-INV/{YY}/",
          seq,
          issueDate,
          template?.header.number_pad ?? 2,
        ),
        quotation_id: q.id,
        template_id: template?.id ?? null,
        project_id: q.project_id,
        client_id: q.client_id,
        to_name: q.to_name,
        to_details: q.to_details,
        title: [q.title, suffix].filter(Boolean).join(" _ ") || null,
        issue_date: issueDate,
        due_date: dueDate,
        basis,
        portion_pct: round2(pct * 100) / 100,
        tax_rate: q.tax_rate,
        terms: template?.tail.terms ?? "",
        signatory_id: signatoryId,
        show_stamp: showStamp,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (data) id = data.id;
    else if (error?.code !== "23505") return { error: error?.message ?? "Could not raise the invoice." };
  }
  if (!id) return { error: "Could not number the invoice — try again." };

  const items = portionLines(
    (lines ?? []).map((l) => ({
      title: l.title,
      description: l.description,
      unit: l.unit,
      qty: Number(l.qty),
      rate: Number(l.rate),
    })),
    pct,
    target,
  );
  const { error: iErr } = await supabase
    .from("invoice_items")
    .insert(items.map((l, i) => ({ ...l, invoice_id: id, sort_order: i })));
  if (iErr) {
    await supabase.from("invoices").delete().eq("id", id);
    return { error: iErr.message };
  }

  refresh(q.project_id);
  redirect(`/invoices/${id}`);
}

export async function setInvoiceStatus(id: string, status: InvoiceStatus): Promise<DocResult> {
  if (!INVOICE_STATUSES.includes(status)) return { error: "Unknown status." };
  const supabase = await createClient();
  const { data: inv, error } = await supabase
    .from("invoices")
    .update({
      status,
      paid_at: status === "paid" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("project_id")
    .maybeSingle();
  if (error) return { error: error.message };
  refresh(inv?.project_id);
  return { ok: true };
}

/** What can change on an invoice once raised: its wording and dates, not its amounts. */
export async function updateInvoice(_prev: unknown, fd: FormData): Promise<DocResult> {
  const supabase = await createClient();
  if (!(await signedIn(supabase))) return { error: "Not signed in." };
  const id = String(fd.get("id") ?? "");
  const toName = String(fd.get("to_name") ?? "").trim();
  if (!toName) return { error: "Who is the invoice for?" };

  const { data: inv, error } = await supabase
    .from("invoices")
    .update({
      to_name: toName,
      to_details: String(fd.get("to_details") ?? "").trim() || null,
      title: String(fd.get("title") ?? "").trim() || null,
      issue_date: String(fd.get("issue_date") ?? "") || today(),
      due_date: String(fd.get("due_date") ?? "") || null,
      terms: String(fd.get("terms") ?? ""),
      signatory_id: String(fd.get("signatory_id") ?? "") || null,
      show_stamp: fd.get("show_stamp") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("project_id")
    .maybeSingle();
  if (error) return { error: error.message };
  refresh(inv?.project_id);
  return { ok: true };
}

export async function deleteInvoice(id: string): Promise<DocResult> {
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select("status, project_id, quotation_id")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return { error: "That invoice no longer exists." };
  if (inv.status === "paid") return { error: "A paid invoice stays on record." };
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh(inv.project_id);
  redirect(inv.quotation_id ? `/quotations/${inv.quotation_id}` : "/invoices");
}

/* ─────────────────────────── stamp & signatures ─────────────────────────── */

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function refreshSigning() {
  revalidatePath("/quotations", "layout");
  revalidatePath("/invoices", "layout");
  revalidatePath("/print", "layout");
}

/** Check an uploaded image and store it; returns its path in the branding bucket. */
async function storeImage(supabase: Supabase, file: FormDataEntryValue | null, folder: string) {
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image." };
  if (file.size > 2 * 1024 * 1024) return { error: "Keep the image under 2MB." };
  if (file.type && !IMAGE_TYPES.includes(file.type)) return { error: "Upload a PNG, JPG or WebP image." };
  const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
  const path = `${folder}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("branding")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "image/png" });
  return error ? { error: `Could not save the image: ${error.message}` } : { path };
}

/** The company stamp — one for the whole company, put on any document that asks for it. */
export async function uploadStamp(_prev: unknown, fd: FormData): Promise<DocResult> {
  const supabase = await createClient();
  if (!(await signedIn(supabase))) return { error: "Not signed in." };
  const stored = await storeImage(supabase, fd.get("file"), "stamp");
  if (stored.error) return { error: stored.error };

  const { data: company } = await supabase.from("company").select("stamp_path").eq("id", true).maybeSingle();
  const { error } = await supabase.from("company").update({ stamp_path: stored.path }).eq("id", true);
  if (error) {
    await supabase.storage.from("branding").remove([stored.path!]);
    return { error: error.message };
  }
  if (company?.stamp_path) await supabase.storage.from("branding").remove([company.stamp_path]);
  refreshSigning();
  return { ok: true };
}

export async function removeStamp(): Promise<DocResult> {
  const supabase = await createClient();
  const { data: company } = await supabase.from("company").select("stamp_path").eq("id", true).maybeSingle();
  if (company?.stamp_path) await supabase.storage.from("branding").remove([company.stamp_path]);
  await supabase.from("company").update({ stamp_path: null }).eq("id", true);
  refreshSigning();
  return { ok: true };
}

/** A signatory's signature. A PNG with a clear background sits best over the stamp. */
export async function uploadSignature(_prev: unknown, fd: FormData): Promise<DocResult> {
  const supabase = await createClient();
  if (!(await signedIn(supabase))) return { error: "Not signed in." };
  const id = String(fd.get("signatory_id") ?? "");
  const { data: who } = await supabase.from("signatories").select("signature_path").eq("id", id).maybeSingle();
  if (!who) return { error: "That signatory no longer exists." };

  const stored = await storeImage(supabase, fd.get("file"), `signatures/${id}`);
  if (stored.error) return { error: stored.error };
  const { error } = await supabase.from("signatories").update({ signature_path: stored.path }).eq("id", id);
  if (error) {
    await supabase.storage.from("branding").remove([stored.path!]);
    return { error: error.message };
  }
  if (who.signature_path) await supabase.storage.from("branding").remove([who.signature_path]);
  refreshSigning();
  return { ok: true };
}

export async function removeSignature(id: string): Promise<DocResult> {
  const supabase = await createClient();
  const { data: who } = await supabase.from("signatories").select("signature_path").eq("id", id).maybeSingle();
  if (who?.signature_path) await supabase.storage.from("branding").remove([who.signature_path]);
  await supabase.from("signatories").update({ signature_path: null }).eq("id", id);
  refreshSigning();
  return { ok: true };
}

/** Add someone who can sign, or change how their name and title print. */
export async function saveSignatory(_prev: unknown, fd: FormData): Promise<DocResult> {
  const supabase = await createClient();
  if (!(await signedIn(supabase))) return { error: "Not signed in." };
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  const title = String(fd.get("title") ?? "").trim() || null;
  if (!name) return { error: "Enter the name as it should print." };

  const { error } = id
    ? await supabase.from("signatories").update({ name, title }).eq("id", id)
    : await supabase.from("signatories").insert({ name, title, sort_order: 99 });
  if (error) return { error: error.message };
  refreshSigning();
  return { ok: true };
}

/** Take someone off the list. Documents they already signed keep their signature. */
export async function retireSignatory(id: string): Promise<DocResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("signatories").update({ active: false }).eq("id", id);
  if (error) return { error: error.message };
  refreshSigning();
  return { ok: true };
}
