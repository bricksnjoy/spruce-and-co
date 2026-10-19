"use server";

import { revalidatePath } from "next/cache";
import { dbMessage, getSession } from "@/server/session";
import type { Book } from "@/lib/books";

export type Result = { error?: string; ok?: boolean };

/** Switch between the Live and Test books. The database records it on your profile. */
export async function setBook(book: Book): Promise<Result> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  if (book !== "live" && book !== "sandbox") return { error: "Choose Live or Test." };
  const { error } = await s.supabase.rpc("rpc_set_book", { p_book: book });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Wipe everything in the Test book. Admin only (the database checks); Live is never touched. */
export async function resetTestBook(_prev: unknown, fd: FormData): Promise<Result> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  if (s.role !== "admin") return { error: "Only an admin can reset the Test book." };
  if (String(fd.get("confirm") ?? "").trim().toUpperCase() !== "RESET") return { error: "Type RESET to confirm." };
  const { error } = await s.supabase.rpc("rpc_reset_test_book");
  if (error) return { error: dbMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}
