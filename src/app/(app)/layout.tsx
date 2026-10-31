import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { visibleFor, quickActionsFor } from "@/lib/nav";
import { signOut } from "@/app/actions/auth";
import { initials } from "@/lib/format";
import { Badge } from "@/components/ui";
import { Logo, Wordmark } from "@/components/logo";
import { MobileNav } from "@/components/mobile-nav";
import { BookGuard } from "@/components/book-guard";
import type { Book } from "@/lib/books";
import { NewMenu } from "@/components/new-menu";
import { PageHelp } from "@/components/page-help";
import { TableLabels } from "@/components/table-labels";
import { ProfileMenu } from "@/components/profile-menu";

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
      .select("full_name, email, role, job_title, active_book, can_payroll")
      .eq("id", user.id)
      .single(),
    supabase.from("company").select("gst_registered").eq("id", true).maybeSingle(),
  ]);

  const name = profile?.full_name || user.email || "User";
  // one set of books for now (migration 031): anyone left in Test is moved back to Live
  if (profile?.active_book === "sandbox") await supabase.rpc("rpc_set_book", { p_book: "live" });
  const book: Book = "live";
  const groups = visibleFor(profile?.role, {
    gstRegistered: company?.gst_registered ?? false,
    book,
  });
  const quickActions = quickActionsFor(profile?.role);
  // the phone's bottom bar: the first four of these this person can open
  const seen = new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
  const tabs = (["/", "/projects", "/tasks", "/bids", "/sales"] as const).filter((h) => seen.has(h)).slice(0, 4);

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
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 sm:px-6 md:static">
          <div className="flex items-center gap-2 md:hidden">
            <MobileNav tabs={tabs}>
              <div className="flex h-16 items-center gap-2.5 border-b border-[var(--border)] px-5">
                <Logo size={34} />
                <Wordmark size="sm" />
              </div>
              {/* who is signed in, and signing out, live in the menu on a phone */}
              <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">
                  {initials(name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight">{name}</p>
                  <Badge value={profile?.role} />
                </div>
                <form action={signOut}>
                  <button type="submit" className="whitespace-nowrap rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted)]">
                    Sign out
                  </button>
                </form>
              </div>
              <form action="/search" method="get" role="search" className="border-b border-[var(--border)] px-5 py-3">
                <input name="q" type="search" placeholder="Search number, name or amount" aria-label="Search"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-base outline-none focus:border-[var(--brand)]" />
              </form>
              <Sidebar groups={groups} quickActions={quickActions} />
            </MobileNav>
            <Logo size={28} />
          </div>
          <div className="flex min-w-0 items-center gap-3 max-md:ml-auto">
            <NewMenu canWrite={["admin", "manager", "finance"].includes(profile?.role ?? "")}
              canPayroll={profile?.role === "admin" || profile?.role === "finance" || Boolean(profile?.can_payroll)} live={book === "live"} />
            <form action="/search" method="get" role="search" className="hidden sm:block">
              <input name="q" type="search" placeholder="Search number, name or amount" aria-label="Search"
                className="w-64 rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-1.5 text-sm outline-none focus:border-[var(--brand)]" />
            </form>
          </div>
          <div className="ml-auto hidden items-center gap-3 md:flex">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{name}</p>
              <p className="text-xs text-[var(--muted)]">
                {profile?.job_title || user.email}
              </p>
            </div>
            <ProfileMenu initials={initials(name)} name={name} email={user.email ?? null} role={<Badge value={profile?.role} />} signOut={signOut} />
          </div>
        </header>
        <main className="flex-1 p-4 pb-28 sm:p-6 sm:pb-28 md:pb-6"><BookGuard book={book}><PageHelp />{children}</BookGuard><TableLabels /></main>
      </div>
    </div>
  );
}
