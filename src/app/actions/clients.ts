"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";

/**
 * Quick-add a customer from a picker (the project form's "Add new customer").
 * Clients and customers are one list: this adds a customer, and the database
 * keeps the old clients table in step for the screens that still read it.
 */
export type ClientResult = {
  error?: string;
  ok?: boolean;
  /** id of the customer just created, so a caller can select it */
  id?: string;
  name?: string;
};

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};

export async function addClient(_prev: unknown, fd: FormData): Promise<ClientResult> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  if (!canWrite(s.role)) return { error: "You can view but not add customers." };

  const name = text(fd, "name");
  if (!name) return { error: "Enter the customer name." };

  const { data: existing } = await s.supabase.from("contacts").select("id")
    .contains("kinds", ["customer"]).ilike("name", name.replace(/[%_\\]/g, (m) => `\\${m}`)).limit(1);
  if (existing?.length) return { error: `${name} is already a customer.` };

  const { data, error } = await s.supabase.from("contacts").insert({
    kinds: ["customer"], name,
    address: text(fd, "address"), phone: text(fd, "phone"), email: text(fd, "email"),
  }).select("id, name").single();
  if (error) return { error: dbMessage(error) };

  revalidatePath("/sales/customers");
  revalidatePath("/projects");
  return { ok: true, id: data.id, name: data.name };
}
