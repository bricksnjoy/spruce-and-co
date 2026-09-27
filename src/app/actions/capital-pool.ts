"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { poolPosition } from "@/lib/pool";
import { today } from "@/lib/format";

export type PoolResult = { error?: string; ok?: boolean };

const refresh = () => {
  revalidatePath("/capital-pool");
  revalidatePath("/", "layout");
};

/**
 * Money put into the pool. Several members can be recorded at once, which is
 * how an opening position — say 300,000 split 50/25/10/10/5 — goes in as one
 * step rather than five.
 */
export async function recordContributions(_prev: unknown, fd: FormData): Promise<PoolResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const date = String(fd.get("entry_date") ?? "").trim() || today();
  const note = String(fd.get("note") ?? "").trim() || null;
  const count = Number(fd.get("count") ?? 0);

  const rows = [];
  for (let i = 0; i < count; i++) {
    const memberId = String(fd.get(`member_${i}`) ?? "");
    const amount = Number(String(fd.get(`amount_${i}`) ?? "").replace(/[^0-9.]/g, ""));
    if (!memberId || !Number.isFinite(amount) || amount <= 0) continue;
    rows.push({
      member_id: memberId,
      entry_type: "contribution" as const,
      amount,
      entry_date: date,
      note,
      created_by: user.id,
    });
  }
  if (!rows.length) return { error: "Enter an amount for at least one member." };

  const { error } = await supabase.from("capital_pool_entries").insert(rows);
  if (error) return { error: error.message };

  refresh();
  return { ok: true };
}

/** A member takes money out of the pool — only what is not tied up in projects. */
export async function recordWithdrawal(_prev: unknown, fd: FormData): Promise<PoolResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const memberId = String(fd.get("member_id") ?? "");
  const amount = Number(String(fd.get("amount") ?? "").replace(/[^0-9.]/g, ""));
  if (!memberId) return { error: "Choose the member." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter the amount." };

  const pos = await poolPosition(supabase);
  const member = pos.members.find((m) => m.id === memberId);
  if (!member) return { error: "That member is not in the pool." };
  if (amount > member.balance) {
    return { error: `${member.name} only has ${member.balance.toFixed(2)} in the pool.` };
  }
  if (amount > member.free + 0.001) {
    return {
      error: `Only ${member.free.toFixed(2)} of ${member.name}'s share is free — ${member.invested.toFixed(2)} is invested in projects not yet paid for.`,
    };
  }
  if (amount > pos.available) {
    return {
      error: `Only ${pos.available.toFixed(2)} is free — the rest is reinvested in projects not yet paid for.`,
    };
  }

  const { error } = await supabase.from("capital_pool_entries").insert({
    member_id: memberId,
    entry_type: "withdrawal",
    amount: -amount,
    entry_date: String(fd.get("entry_date") ?? "").trim() || today(),
    note: String(fd.get("note") ?? "").trim() || null,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  refresh();
  return { ok: true };
}

/** Only hand-entered rows can be removed; the system's own come and go with payments. */
export async function deletePoolEntry(id: string): Promise<PoolResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("capital_pool_entries")
    .delete()
    .eq("id", id)
    .eq("origin", "manual");
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}
