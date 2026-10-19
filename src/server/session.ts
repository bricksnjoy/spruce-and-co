import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";
import type { Book } from "@/lib/books";

export type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  role: UserRole;
  book: Book;
  canPayroll: boolean;
};

/** The signed-in user with their role and the book they are working in; null if signed out. */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("role, active_book, can_payroll").eq("id", user.id).maybeSingle();
  const role = (data?.role ?? "viewer") as UserRole;
  return {
    supabase,
    userId: user.id,
    role,
    book: (data?.active_book ?? "live") as Book,
    canPayroll: role === "admin" || role === "finance" || Boolean(data?.can_payroll),
  };
}

export const canWrite = (r: UserRole) => r === "admin" || r === "manager" || r === "finance";

/** Turn a database refusal into the sentence it carries, without Postgres noise. */
export function dbMessage(e: { message?: string } | null | undefined, fallback = "That could not be saved.") {
  const m = e?.message?.trim();
  if (!m) return fallback;
  if (/row-level security/i.test(m)) return "You do not have permission to change this.";
  return m;
}
