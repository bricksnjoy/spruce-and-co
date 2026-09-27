"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isLocked, projectOf, LOCKED } from "@/lib/project-lock";
import type { Result } from "./projects";
import { today } from "@/lib/format";

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const number = (fd: FormData, k: string) => {
  const n = Number(String(fd.get(k) ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const int = (fd: FormData, k: string) => {
  const n = parseInt(String(fd.get(k) ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};


/* ------------------------------------------------------------------ */
/* Variations                                                          */
/* ------------------------------------------------------------------ */

export async function addVariation(_prev: unknown, fd: FormData): Promise<Result> {
  const supabase = await createClient();
  if (await isLocked(supabase, String(fd.get("project_id") ?? ""))) return { error: LOCKED };
  const projectId = String(fd.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };

  const description = text(fd, "description");
  if (!description) return { error: "Describe the variation." };

  // next reference for this project: VO-001, VO-002, ...
  const { count } = await supabase
    .from("variations")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  const ref = `VO-${String((count ?? 0) + 1).padStart(3, "0")}`;

  const { error } = await supabase.from("variations").insert({
    project_id: projectId,
    ref,
    title: description.slice(0, 120),
    description,
    // approved on entry: a variation is only recorded once the client agrees it,
    // and only approved variations count toward the project value
    status: "approved",
    cost_impact: number(fd, "cost_impact"),
    time_impact_days: int(fd, "time_impact_days"),
    raised_date: text(fd, "raised_date") ?? today(),
    approved_date: text(fd, "raised_date") ?? today(),
  });

  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/pnl");
  revalidatePath("/projects");
  revalidatePath("/");
  return { ok: true };
}

/** Reports its result, so a modal knows when to close. */
export async function updateVariation(_prev: unknown, fd: FormData): Promise<Result> {
  const supabase = await createClient();
  if (await isLocked(supabase, String(fd.get("project_id") ?? ""))) return { error: LOCKED };
  const id = String(fd.get("id") ?? "");
  const projectId = String(fd.get("project_id") ?? "");
  if (!id) return { error: "Missing variation." };

  const description = text(fd, "description");
  if (!description) return { error: "Describe the variation." };

  const { error } = await supabase
    .from("variations")
    .update({
      description,
      title: description.slice(0, 120),
      cost_impact: number(fd, "cost_impact"),
      time_impact_days: int(fd, "time_impact_days"),
      raised_date: text(fd, "raised_date"),
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/pnl");
  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteVariation(id: string, projectId: string) {
  const supabase = await createClient();
  if (await isLocked(supabase, await projectOf(supabase, "variations", id))) return;
  await supabase.from("variations").delete().eq("id", id);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/pnl");
  revalidatePath("/projects");
}

/* ------------------------------------------------------------------ */
/* Bills                                                               */
/* ------------------------------------------------------------------ */

const MAX_BYTES = 20 * 1024 * 1024;

export type VendorCandidate = {
  id: string;
  name: string;
  tin: string | null;
  score: number;
  match_kind: "exact" | "tin_match" | "similar";
};

/** Raised when the shop on a bill does not cleanly match one already on file. */
export type VendorConfirm = {
  kind: "tin_mismatch" | "tin_match" | "similar_name" | "new_shop";
  entered_name: string;
  entered_tin: string | null;
  candidates: VendorCandidate[];
};

export type BillResult = Result & { confirm?: VendorConfirm };

const normaliseTin = (t: string | null) =>
  t ? t.replace(/\s/g, "").toUpperCase() : null;

/**
 * Work out which shop a bill belongs to.
 *
 * Bills are photographed, and a blurry photo misreads names and TINs. Rather
 * than trusting the text — which would quietly create "Sonee Hardwre" beside
 * "Sonee Hardware", splitting a supplier across two entries in the GST
 * schedule — anything short of a clean match is handed back for a human to
 * confirm.
 *
 * Once confirmed, the caller resubmits with confirm_vendor_id or
 * create_new_vendor and this runs straight through.
 */
async function resolveVendor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fd: FormData,
): Promise<{ vendorId?: string | null; confirm?: VendorConfirm; error?: string }> {
  const shop = text(fd, "shop");
  if (!shop) return { error: "Enter the shop or supplier name." };
  const tin = text(fd, "supplier_tin");

  // already answered by the person entering the bill
  const confirmed = text(fd, "confirm_vendor_id");
  if (confirmed) {
    if (tin && String(fd.get("tin_action") ?? "") === "update") {
      await supabase.from("vendors").update({ tin }).eq("id", confirmed);
    }
    return { vendorId: confirmed };
  }
  if (String(fd.get("create_new_vendor") ?? "") === "1") {
    const { data } = await supabase
      .from("vendors")
      .insert({ name: shop, kind: "supplier", is_approved: true, tin })
      .select("id")
      .single();
    return { vendorId: data?.id ?? null };
  }

  const { data } = await supabase.rpc("find_similar_vendors", {
    p_name: shop,
    p_tin: tin,
  });
  const candidates = (data ?? []) as VendorCandidate[];
  const exact = candidates.find((c) => c.match_kind === "exact");

  if (exact) {
    // same shop, but the TIN read off this bill disagrees with the one on
    // file — one of the two is a misread, and only a human knows which
    if (tin && exact.tin && normaliseTin(exact.tin) !== normaliseTin(tin)) {
      return {
        confirm: {
          kind: "tin_mismatch",
          entered_name: shop,
          entered_tin: tin,
          candidates: [exact],
        },
      };
    }
    // first TIN seen for a known shop: record it
    if (tin && !exact.tin) {
      await supabase.from("vendors").update({ tin }).eq("id", exact.id);
    }
    return { vendorId: exact.id };
  }

  if (candidates.length > 0) {
    const byTin = candidates.some((c) => c.match_kind === "tin_match");
    return {
      confirm: {
        kind: byTin ? "tin_match" : "similar_name",
        entered_name: shop,
        entered_tin: tin,
        candidates,
      },
    };
  }

  // nothing like it on file — a genuinely new supplier
  const { data: created } = await supabase
    .from("vendors")
    .insert({ name: shop, kind: "supplier", is_approved: true, tin })
    .select("id")
    .single();
  return { vendorId: created?.id ?? null };
}

/**
 * Record a bill against a project. A photo is optional but usual — it is
 * stored in the private "bills" bucket and the path kept on the row, so the
 * original is always available behind the figure.
 */
export async function addBill(_prev: unknown, fd: FormData): Promise<BillResult> {
  const supabase = await createClient();
  if (await isLocked(supabase, String(fd.get("project_id") ?? ""))) return { error: LOCKED };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const projectId = String(fd.get("project_id") ?? "");
  if (!projectId) return { error: "Missing project." };

  const shop = text(fd, "shop");
  if (!shop) return { error: "Enter the shop or supplier name." };

  const total = number(fd, "total");
  if (total <= 0) return { error: "Enter the bill total." };

  // Settle the shop before touching storage: a confirmation round would
  // otherwise leave an orphaned upload behind on every pass.
  const resolved = await resolveVendor(supabase, fd);
  if (resolved.error) return { error: resolved.error };
  if (resolved.confirm) return { confirm: resolved.confirm };

  const gst = number(fd, "tax_amount");
  const net = number(fd, "subtotal") || total - gst;

  let attachmentPath: string | null = null;
  const file = fd.get("photo");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { error: "That image is larger than 20MB." };
    const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
    const path = `${projectId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from("bills")
      .upload(path, bytes, { contentType: file.type || "image/jpeg" });
    if (upErr) return { error: `Could not save the photo: ${upErr.message}` };
    attachmentPath = path;
  }

  const { count } = await supabase
    .from("bills")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { error } = await supabase.from("bills").insert({
    bill_no: text(fd, "bill_no") ?? `B-${String((count ?? 0) + 1).padStart(3, "0")}`,
    vendor_id: resolved.vendorId,
    project_id: projectId,
    category_id: text(fd, "category_id"),
    status: "paid",
    issue_date: text(fd, "issue_date") ?? today(),
    subtotal: net,
    tax_amount: gst,
    total,
    description: text(fd, "description") ?? shop,
    gst_rate: number(fd, "gst_rate"),
    taxable_activity_no: text(fd, "taxable_activity_no"),
    expense_class: text(fd, "expense_class") ?? "revenue",
    attachment_path: attachmentPath,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/pnl");
  revalidatePath("/projects");
  revalidatePath("/gst");
  revalidatePath("/");
  return { ok: true };
}

/** Reports its result, so a modal knows when to close. */
export async function updateBill(fd: FormData): Promise<void> {
  const supabase = await createClient();
  if (await isLocked(supabase, await projectOf(supabase, "bills", String(fd.get("id") ?? "")))) return;
  const id = String(fd.get("id") ?? "");
  const projectId = String(fd.get("project_id") ?? "");
  if (!id) return;

  const total = number(fd, "total");
  const gst = number(fd, "tax_amount");

  const { error } = await supabase
    .from("bills")
    .update({
      description: text(fd, "description"),
      issue_date: text(fd, "issue_date"),
      subtotal: number(fd, "subtotal") || total - gst,
      tax_amount: gst,
      total,
      gst_rate: number(fd, "gst_rate"),
      taxable_activity_no: text(fd, "taxable_activity_no"),
      expense_class: text(fd, "expense_class") ?? "revenue",
    })
    .eq("id", id);

  if (error) return;
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/pnl");
  revalidatePath("/projects");
}

export async function deleteBill(id: string, projectId: string) {
  const supabase = await createClient();
  if (await isLocked(supabase, await projectOf(supabase, "bills", id))) return;
  const { data: bill } = await supabase
    .from("bills")
    .select("attachment_path")
    .eq("id", id)
    .maybeSingle();

  await supabase.from("bills").delete().eq("id", id);
  if (bill?.attachment_path) {
    await supabase.storage.from("bills").remove([bill.attachment_path]);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/pnl");
  revalidatePath("/projects");
}
