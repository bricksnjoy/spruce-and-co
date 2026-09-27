import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { visibleFor, quickActionsFor } from "@/lib/nav";
import { signOut } from "@/app/actions/auth";
import { initials } from "@/lib/format";
import { Badge } from "@/components/ui";
import { Logo, Wordmark } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: company }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, email, role, job_title")
      .eq("id", user.id)
      .single(),
    supabase.from("company").select("gst_registered").eq("id", true).maybeSingle(),
  ]);

  const name = profile?.full_name || user.email || "User";
  const groups = visibleFor(profile?.role, {
    gstRegistered: company?.gst_registered ?? false,
  });
  const quickActions = quickActionsFor(profile?.role);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] md:block">
        <div className="flex h-16 items-center gap-2.5 border-b border-[var(--border)] px-5">
          <Logo size={34} />
          <Wordmark size="sm" />
        </div>
        <Sidebar
          groups={groups}
          quickActions={quickActions}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 sm:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <MobileNav>
              <div className="flex h-16 items-center gap-2.5 border-b border-[var(--border)] px-5">
                <Logo size={34} />
                <Wordmark size="sm" />
              </div>
              <Sidebar groups={groups} quickActions={quickActions} />
            </MobileNav>
            <Logo size={28} />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{name}</p>
              <p className="text-xs text-[var(--muted)]">
                {profile?.job_title || user.email}
              </p>
            </div>
            <Badge value={profile?.role} />
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">
              {initials(name)}
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--text)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
