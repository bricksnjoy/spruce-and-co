"use server";

import { revalidatePath } from "next/cache";
import { canWrite, dbMessage, getSession } from "@/server/session";
import { dbToLaari } from "@/lib/money";

export type Result = { error?: string; ok?: boolean; id?: string };

const TYPES = ["asset", "liability", "equity", "income", "cogs", "expense"] as const;
const CATEGORIES = ["materials", "subcontractors", "labour", "equipment", "freight", "site", "other"] as const;
// asset accounts that can be many: each bank, each class of fixed asset
const ASSET_KINDS: Record<string, string | null> = { other: null, bank: "bank", fixed_asset: "fixed_asset" };

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};

async function writer() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!canWrite(s.role)) return { error: "You can view but not change the chart of accounts." } as const;
  return { s } as const;
}

function validCode(code: string | null) {
  return code !== null && /^[0-9A-Za-z][0-9A-Za-z-]{1,15}$/.test(code);
}

/** Add an account to the chart. It belongs to both books; balances are kept per book. */
export async function createAccount(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const code = text(fd, "code");
  const name = text(fd, "name");
  const type = text(fd, "type") as (typeof TYPES)[number] | null;
  if (!validCode(code)) return { error: "Give the account a code of 2–16 letters, digits or dashes, e.g. 6150." };
  if (!name) return { error: "Give the account a name." };
  if (!type || !TYPES.includes(type)) return { error: "Choose the account type." };

  const parent_id = text(fd, "parent_id");
  const kind = type === "asset" ? text(fd, "asset_kind") ?? "other" : "other";
  if (!(kind in ASSET_KINDS)) return { error: "Choose what kind of asset this is." };
  const category = type === "cogs" ? text(fd, "budget_category") ?? "other" : null;
  if (category !== null && !(CATEGORIES as readonly string[]).includes(category)) return { error: "Choose the budget category." };
  const currency = kind === "bank" ? text(fd, "currency") ?? "MVR" : "MVR";

  const { data, error } = await w.s.supabase.from("accounts").insert({
    code, name, type, parent_id, subtype: ASSET_KINDS[kind], currency,
    budget_category: category, description: text(fd, "description"),
  }).select("id").single();
  if (error) {
    if (/accounts_code_key|duplicate key/.test(error.message)) return { error: `Code ${code} is already used.` };
    return { error: dbMessage(error) };
  }
  revalidatePath("/accounting/chart");
  return { ok: true, id: data.id };
}

/** Rename, re-describe, re-code (non-system only) or switch an account on or off. */
export async function updateAccount(_prev: unknown, fd: FormData): Promise<Result> {
  const w = await writer();
  if ("error" in w) return { error: w.error };
  const id = text(fd, "id");
  if (!id) return { error: "No account." };
  const { data: acct } = await w.s.supabase.from("accounts").select("id, is_system, type, contact_id").eq("id", id).maybeSingle();
  if (!acct) return { error: "No such account." };

  const name = text(fd, "name");
  if (!name) return { error: "Give the account a name." };
  const active = fd.get("active") === "on";
  const patch: Record<string, unknown> = { name, description: text(fd, "description"), active };
  if (!acct.is_system) {
    const code = text(fd, "code");
    if (!validCode(code)) return { error: "Give the account a code of 2–16 letters, digits or dashes." };
    patch.code = code;
  }
  if (acct.type === "cogs") {
    const category = text(fd, "budget_category") ?? "other";
    if (!(CATEGORIES as readonly string[]).includes(category)) return { error: "Choose the budget category." };
    patch.budget_category = category;
  }

  if (!active) {
    // an account with money in it stays on, so its balance never drops out of the reports
    const { data: bal } = await w.s.supabase.rpc("rpc_account_balances", {});
    const row = (bal ?? []).find((b: { account_id: string; balance: number | string }) => b.account_id === id);
    if (row && dbToLaari(row.balance) !== 0n) return { error: "This account still has a balance. Move it to another account before switching it off." };
  }

  const { error } = await w.s.supabase.from("accounts").update(patch).eq("id", id);
  if (error) {
    if (/accounts_code_key|duplicate key/.test(error.message)) return { error: "That code is already used." };
    return { error: dbMessage(error) };
  }
  revalidatePath("/accounting/chart");
  revalidatePath(`/accounting/chart/${id}`);
  return { ok: true };
}
