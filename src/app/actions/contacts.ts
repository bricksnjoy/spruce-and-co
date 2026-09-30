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
  };
}

function check(f: ReturnType<typeof fields>, kinds: string[]): string | null {
  if (!f.name) return "Enter the name.";
  if (!kinds.length) return "Tick at least one of customer, vendor or lender.";
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return "That email address does not look right.";
  if (Number.isNaN(f.terms_days)) return "Payment terms are a number of days, e.g. 30.";
  if (f.vendor_kind && !VENDOR_KINDS.includes(f.vendor_kind)) return "Choose what kind of vendor this is.";
  if (!isDate(f.licence_expiry) || !isDate(f.insurance_expiry)) return "Enter expiry dates as dates.";
  // input GST can only be claimed from a registered supplier with a TIN (§8)
  if (f.gst_registered && !f.tin) return "A GST-registered contact needs a TIN.";
  return null;
}

function kindsFrom(fd: FormData, keep: string[] = []) {
  const picked = EDITABLE_KINDS.filter((k) => fd.get(`kind_${k}`) === "on");
  return [...new Set([...picked, ...keep.filter((k) => !EDITABLE_KINDS.includes(k))])];
}

/** Paths that show a contact, for revalidation. */
function refresh(id?: string) {
  for (const base of ["/sales/customers", "/expenses/vendors"]) {
    revalidatePath(base);
    if (id) revalidatePath(`${base}/${id}`);
  }
}

export async function createContact(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
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
