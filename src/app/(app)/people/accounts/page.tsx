import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getSession } from "@/server/session";
import { ACCOUNT_LABEL, initialsOf, loadAccounts, type Account } from "@/server/accounts";
import { laariToNumber } from "@/lib/money";

export const dynamic = "force-dynamic";
// the bare figure, as a bank app shows it, with MVR under it
const amount = (v: bigint) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(laariToNumber(v));

/** People → Accounts: the company's and each partner's account, listed like a bank app; each opens its breakdown. */
export default async function AccountsPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role === "viewer") redirect("/");
  const { company, people } = await loadAccounts(s);
  const all: Account[] = [company, ...people];

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="Accounts" subtitle="The company's and each partner's account. Open one to see it project by project." />
      <Card className="overflow-hidden">
        <ul className="divide-y divide-[var(--border)]">
          {all.map((a) => (
            <li key={a.id}>
              <Link href={`/people/accounts/${a.id}`} className="flex items-center gap-4 px-5 py-5 transition-colors hover:bg-[var(--hover)] sm:px-6">
                <span aria-hidden className={`grid size-14 shrink-0 place-items-center rounded-full text-lg font-medium text-white ${
                  a.kind === "company" ? "bg-[#27315a]" : a.kind === "director" ? "bg-[#c9c656]" : "bg-[#6b8fa8]"}`}>
                  {a.kind === "company" ? "CA" : initialsOf(a.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium leading-snug">{ACCOUNT_LABEL[a.kind]}</span>
                  <span className="block truncate text-sm uppercase tracking-wide text-[var(--muted)]">{a.kind === "company" ? "Spruce & Co" : a.name}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {a.kind === "company" ? "Its own money" : a.kind === "director" ? "Owed on projects and kept in the company" : "Owed on projects"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`block text-lg font-medium tabular-nums ${a.balance < 0n ? "text-red-700" : ""}`}>{amount(a.balance)}</span>
                  <span className="block text-sm text-[var(--muted)]">MVR</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
