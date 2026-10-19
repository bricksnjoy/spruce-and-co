"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";
import { billLookups, readBillSheet } from "@/server/project-bills";
import { checkRows, type BillGroup, type PreviewRow, type RawRow } from "@/lib/bill-import";

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
export type Preview = { error?: string; raw?: RawRow[]; rows?: PreviewRow[]; bills?: number; total?: string };
export type SaveResult = { error?: string; saved?: number; skipped?: number; failed?: { rows: number[]; error: string }[]; notes?: string[] };

async function writer() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!canWrite(s.role)) return { error: "You can view but not add bills." } as const;
  return { s } as const;
}

/** Read an uploaded sheet and check every row; nothing is saved yet. */
export async function previewBillSheet(projectId: string, fd: FormData): Promise<Preview> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (!isId(projectId)) return { error: "No project." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the filled-in sheet (.xlsx or .csv)." };
  if (file.size > 5 * 1024 * 1024) return { error: "That file is over 5 MB; is it the right sheet?" };
  let raw: RawRow[];
  try { raw = await readBillSheet(file); } catch { return { error: "That file could not be read. Save it as .xlsx (or .csv) and try again." }; }
  if (!raw.length) return { error: "The sheet has no rows under the headings." };
  if (raw.length > 1000) return { error: "Upload up to 1,000 rows at a time." };
  const { rows, bills } = checkRows(raw, await billLookups(w.s, projectId));
  const total = bills.reduce((t, b) => t + Number(b.total), 0).toFixed(2);
  return { raw, rows, bills: bills.length, total };
}

/**
 * Save the new bills from checked rows. The rows are checked again here, so
 * only what the preview showed as new is saved; anything already saved is
 * skipped, which makes uploading the same sheet twice harmless.
 */
export async function saveBillSheet(projectId: string, raw: RawRow[]): Promise<SaveResult> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const s = w.s;
  if (!isId(projectId)) return { error: "No project." };
  if (!Array.isArray(raw) || raw.length > 1000) return { error: "Nothing to save." };
  const { rows, bills } = checkRows(raw, await billLookups(s, projectId));
  if (rows.some((r) => r.status === "error")) return { error: "Some rows still have problems. Fix them in the sheet and upload it again." };

  const vendorIds = new Map<string, string>();
  const failed: { rows: number[]; error: string }[] = [];
  const notes: string[] = [];
  let saved = 0;
  for (const b of bills) {
    try {
      const contact = b.vendor_id ?? (await newVendor(s, b, vendorIds, bills));
      const id = await saveOne(s, projectId, b, contact);
      if (id.note) notes.push(`Rows ${b.rows.join(", ")}: ${id.note}`);
      saved++;
    } catch (e) {
      failed.push({ rows: b.rows, error: (e as Error).message });
    }
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/expenses");
  return { saved, skipped: rows.filter((r) => r.status === "saved").length, failed, notes };
}

type S = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** A vendor named in the sheet but not on file: added once, marked for review. */
async function newVendor(s: S, b: BillGroup, made: Map<string, string>, all: BillGroup[]) {
  const key = b.vendor.trim().toLowerCase();
  if (made.has(key)) return made.get(key)!;
  const claims = all.some((x) => x.vendor.trim().toLowerCase() === key && x.lines.some((l) => l.gst_claimable));
  const { data, error } = await s.supabase.from("contacts")
    .insert({ name: b.vendor.trim(), kinds: ["vendor"], tin: b.vendor_tin, gst_registered: claims, needs_review: true })
    .select("id").single();
  if (error) throw new Error(`Adding vendor ${b.vendor}: ${dbMessage(error)}`);
  made.set(key, data.id);
  return data.id as string;
}

/** One bill, posted the way the bill form posts it (over the approval limit: to an admin). */
async function saveOne(s: S, projectId: string, b: BillGroup, contact: string): Promise<{ id: string; note?: string }> {
  const payload = {
    type: "bill", date: b.date, due_date: b.due_date ?? b.date, contact_id: contact, project_id: projectId, currency: "MVR", fx_rate: "1",
    reference: b.reference, supplier_tin: b.vendor_tin, tax_invoice_no: b.invoice_no, tax_invoice_date: b.invoice_date, is_draft: false,
    memo: "From a bills sheet",
    lines: b.lines.map((l) => ({ ...l, description: l.description || null, project_id: projectId })),
  };
  let { data, error } = await s.supabase.rpc("rpc_save_transaction", { p: payload });
  if (error && /approval limit/.test(error.message)) {
    ({ data, error } = await s.supabase.rpc("rpc_save_transaction", { p: { ...payload, is_draft: true } }));
    if (error) throw new Error(dbMessage(error));
    const r = s.role === "admin"
      ? await s.supabase.rpc("rpc_approve_bill", { p_id: data })
      : await s.supabase.rpc("rpc_request_approval", { p_id: data });
    if (r.error) throw new Error(`Saved as a draft, but: ${dbMessage(r.error)}`);
    return { id: data as string, note: s.role === "admin" ? "over the approval limit: approved by you" : "over the approval limit: sent for approval" };
  }
  if (error) throw new Error(dbMessage(error));
  return { id: data as string };
}
