"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";
import { moneyToDb } from "@/lib/money";

export type Result = { error?: string; ok?: boolean; id?: string };

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

async function writer() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!canWrite(s.role)) return { error: "You can view but not change tax returns." } as const;
  return { s } as const;
}

/** File a GST return: it is locked and the settlement is posted (§8 steps 3–4). */
export async function fileReturn(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const period = text(fd, "period_id");
  if (!isId(period)) return { error: "No return." };
  if (fd.get("confirm") !== "on") return { error: "Tick the box to confirm the figures match what you filed with MIRA." };
  const { data, error } = await w.s.supabase.rpc("rpc_file_gst", { p_period: period, p_reference: text(fd, "reference") ?? "" });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/taxes", "layout");
  return { ok: true, id: (data as string | null) ?? period };
}

/** Pay MIRA what a filed return owes (§8 step 5); part payments are allowed. */
export async function payReturn(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const period = text(fd, "period_id"), bank = text(fd, "bank_id"), date = text(fd, "date");
  if (!isId(period)) return { error: "No return." };
  if (!isId(bank)) return { error: "Choose the account it was paid from." };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the date it was paid." };
  const raw = text(fd, "amount");
  const amount = raw === null ? null : moneyToDb(raw);
  if (raw !== null && amount === null) return { error: "The amount must be a number." };
  const { data, error } = await w.s.supabase.rpc("rpc_pay_gst", { p_period: period, p_bank: bank, p_date: date, p_amount: amount });
  if (error) return { error: dbMessage(error) };
  revalidatePath("/taxes", "layout");
  return { ok: true, id: data as string };
}
