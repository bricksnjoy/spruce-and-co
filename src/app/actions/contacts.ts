"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";
import { dbToLaari } from "@/lib/money";

export type Result = { error?: string; ok?: boolean; id?: string };

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const isDate = (v: string | null) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);
const VENDOR_KINDS = ["supplier", "subcontractor", "consultant", "other"];
const EDITABLE_KINDS = ["customer", "vendor", "lender"];   // partners are set up with the capital pool

async function writer() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!canWrite(s.role)) return { error: "You can view but not change contacts." } as const;
  return { s } as const;
}

function fields(fd: FormData) {
  const tin = text(fd, "tin")?.replace(/\s+/g, "").toUpperCase() ?? null;
  const terms = text(fd, "terms_days");
  return {
    name: text(fd, "name"),
    company_name: text(fd, "company_name"),
    contact_person: text(fd, "contact_person"),
    email: text(fd, "email"),
    phone: text(fd, "phone"),
    address: text(fd, "address"),
    tin,
    gst_registered: fd.get("gst_registered") === "on",
    taxable_activity_no: text(fd, "taxable_activity_no")?.replace(/\s+/g, "").toUpperCase() ?? null,
    bank_details: text(fd, "bank_details"),
    terms_days: terms === null ? null : /^\d{1,3}$/.test(terms) ? Number(terms) : NaN,
    currency: text(fd, "currency") ?? "MVR",
    vendor_kind: text(fd, "vendor_kind"),
    trade: text(fd, "trade"),
    licence_expiry: text(fd, "licence_expiry"),
    insurance_expiry: text(fd, "insurance_expiry"),
    notes: text(fd, "notes"),
    // a lender's share of the project's profit; blank is the scheme's 20%. Only set when the form has it.
    ...(fd.has("profit_percent") ? { profit_percent: pctOf(text(fd, "profit_percent")) } : {}),
  };
}

const pctOf = (v: string | null) => (v === null ? null : /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100 ? Number(v) : NaN);

function check(f: ReturnType<typeof fields>, kinds: string[]): string | null {
  if (!f.name) return "Enter the name.";
  if (!kinds.length) return "Tick at least one of customer, vendor or lender.";
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return "That email address does not look right.";
  if (Number.isNaN(f.profit_percent)) return "The profit percentage is a number from 0 to 100, e.g. 20.";
  if (Number.isNaN(f.terms_days)) return "Payment terms are a number of days, e.g. 30.";
  if (f.vendor_kind && !VENDOR_KINDS.includes(f.vendor_kind)) return "Choose what kind of vendor this is.";
  if (!isDate(f.licence_expiry) || !isDate(f.insurance_expiry)) return "Enter expiry dates as dates.";
  // input GST can only be claimed from a registered supplier with a TIN (§8)
  if (f.gst_registered && !f.tin) return "A GST-registered contact needs a TIN.";
  return null;
}

function kindsFrom(fd: FormData, keep: string[] = []) {
  // a new lender is either an outside lender or one of the directors (a partner)
  // a new director (People → Accounts → New account)
  if (fd.get("new_director") === "on") return ["partner"];
  const lender = fd.get("lender_type");
  if (lender === "director") return ["partner"];
  if (lender === "external") return ["lender"];
  const picked = EDITABLE_KINDS.filter((k) => fd.get(`kind_${k}`) === "on");
  return [...new Set([...picked, ...keep.filter((k) => !EDITABLE_KINDS.includes(k))])];
}

/** Paths that show a contact, for revalidation. */
function refresh(id?: string) {
  for (const base of ["/sales/customers", "/expenses/vendors", "/partners/lenders", "/partners", "/people/accounts"]) {
    revalidatePath(base);
    if (id) revalidatePath(`${base}/${id}`);
  }
}

export async function createContact(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  // a director lending is already in the app: they are added to Lenders, not made again
  if (fd.get("lender_type") === "director") {
    const id = String(fd.get("director_id") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Choose the director." };
    const { data: d } = await w.s.supabase.from("contacts").select("kinds").eq("id", id).maybeSingle();
    if (!d) return { error: "That director was not found." };
    const kinds = [...new Set([...(d.kinds as string[]), "lender"])];
    const { error } = await w.s.supabase.from("contacts").update({ kinds, active: true, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return { error: dbMessage(error) };
    refresh(id);
    return { ok: true, id };
  }
  const f = fields(fd);
  const kinds = kindsFrom(fd);
  const bad = check(f, kinds);
  if (bad) return { error: bad };

  // the same name twice in one book is almost always a duplicate
  const { data: same } = await w.s.supabase.from("contacts").select("id, name").ilike("name", f.name!.replace(/[%_\\]/g, (m) => `\\${m}`)).limit(1);
  if (same?.length && fd.get("allow_duplicate") !== "on") {
    return { error: `${same[0].name} already exists. Tick "add anyway" if this really is a different contact.` };
  }
  if (f.tin) {
    const { data: tin } = await w.s.supabase.from("contacts").select("name").eq("tin", f.tin).limit(1);
    if (tin?.length && fd.get("allow_duplicate") !== "on") return { error: `TIN ${f.tin} already belongs to ${tin[0].name}.` };
  }

  // the book is set by the database from the one you are working in
  const { data, error } = await w.s.supabase.from("contacts").insert({ ...f, kinds }).select("id").single();
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true, id: data.id };
}

export async function updateContact(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const id = text(fd, "id");
  if (!id) return { error: "No contact." };
  const { data: cur } = await w.s.supabase.from("contacts").select("kinds").eq("id", id).maybeSingle();
  if (!cur) return { error: "No such contact." };
  const f = fields(fd);
  const kinds = kindsFrom(fd, cur.kinds ?? []);
  const bad = check(f, kinds);
  if (bad) return { error: bad };
  const { error } = await w.s.supabase.from("contacts").update({ ...f, kinds, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { ok: true, id };
}

/** Confirm a copied-over contact is real (clears "needs review"), or archive it. */
export async function reviewContact(id: string, action: "confirm" | "archive" | "restore"): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (action === "archive") {
    const { data: b } = await w.s.supabase.from("contact_balances_v").select("receivable, payable").eq("contact_id", id).maybeSingle();
    if (b && (dbToLaari(b.receivable) !== 0n || dbToLaari(b.payable) !== 0n)) return { error: "This contact still has an open balance, so it stays active." };
  }
  const patch = action === "confirm" ? { needs_review: false }
    : action === "archive" ? { active: false, needs_review: false } : { active: true };
  const { error } = await w.s.supabase.from("contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: dbMessage(error) };
  refresh(id);
  return { ok: true };
}

/** Delete a contact that nothing in the books points to (admin only); one with documents or loans is refused. */
export async function deleteContact(id: string): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  if (w.s.role !== "admin") return { error: "Only an admin can delete a contact." };
  const [{ count: live }, { count: all }] = await Promise.all([
    w.s.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("contact_id", id).is("voided_at", null),
    w.s.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("contact_id", id),
  ]);
  if ((live ?? 0) > 0) {
    return { error: "They have loans or documents in the books, so they can't be deleted. Delete those first (a loan from the bin on the project's Financing tab)." };
  }
  // only deleted (void) documents left: they stay on record, so the contact is put away instead
  if ((all ?? 0) > 0) {
    const { error } = await w.s.supabase.from("contacts").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return { error: dbMessage(error) };
    refresh();
    return { ok: true };
  }
  const { data, error } = await w.s.supabase.from("contacts").delete().eq("id", id).select("id");
  if (error) return { error: /foreign key/i.test(error.message) ? "Something in the books still points to them, so they can't be deleted." : dbMessage(error) };
  if (!data?.length) return { error: "They could not be deleted." };
  refresh();
  return { ok: true };
}
