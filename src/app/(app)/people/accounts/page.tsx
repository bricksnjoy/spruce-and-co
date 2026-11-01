import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getSession, canWrite } from "@/server/session";
import { ACCOUNT_LABEL, initialsOf, loadAccounts, type Account } from "@/server/accounts";
import { NewAccountButton } from "@/components/accounts/new-account";
import { laariToNumber } from "@/lib/money";

export const dynamic = "force-dynamic";
// the bare figure, as a bank app shows it, with MVR under it
const amount = (v: bigint) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(laariToNumber(v));

type RowSpec = { key: string; href: string; badge: string; tone: string; title: string; holder: string; note: string; balance: bigint };

function Row({ r }: { r: RowSpec }) {
  return (
    <li>
      <Link href={r.href} className="flex items-center gap-4 px-5 py-5 transition-colors hover:bg-[var(--hover)] sm:px-6">
        <span aria-hidden className={`grid size-14 shrink-0 place-items-center rounded-full text-lg font-medium text-white ${r.tone}`}>{r.badge}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium leading-snug">{r.title}</span>
          <span className="block truncate text-sm uppercase tracking-wide text-[var(--muted)]">{r.holder}</span>
          <span className="block text-xs text-[var(--muted)]">{r.note}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className={`block text-lg font-medium tabular-nums ${r.balance < 0n ? "text-red-700" : ""}`}>{amount(r.balance)}</span>
          <span className="block text-sm text-[var(--muted)]">MVR</span>
        </span>
      </Link>
    </li>
  );
}

function Section({ title, total, rows, empty }: { title: string; total: bigint; rows: RowSpec[]; empty: string }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</h2>
        <span className="text-sm tabular-nums text-[var(--muted)]">{amount(total)} MVR</span>
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? <p className="px-5 py-6 text-sm text-[var(--muted)]">{empty}</p>
          : <ul className="divide-y divide-[var(--border)]">{rows.map((r) => <Row key={r.key} r={r} />)}</ul>}
      </Card>
    </section>
  );
}

/** People → Accounts: the company's, the directors' and the lenders' accounts, listed like a bank app. */
export default async function AccountsPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role === "viewer") redirect("/");
  const { company, people, banks } = await loadAccounts(s);
  const person = (a: Account): RowSpec => ({
    key: a.id, href: `/people/accounts/${a.id}`, badge: initialsOf(a.name),
    tone: a.kind === "director" ? "bg-[#c9c656]" : "bg-[#6b8fa8]", title: ACCOUNT_LABEL[a.kind], holder: a.name,
    note: a.kind === "director" ? "Owed on projects and kept in the company" : "Owed on projects", balance: a.balance,
  });
  const companyRows: RowSpec[] = [
    { key: "company", href: "/people/accounts/company", badge: "CA", tone: "bg-[#27315a]", title: ACCOUNT_LABEL.company, holder: "Spruce & Co",
      note: "Its own money: bank and cash less everything it owes", balance: company.balance },
    ...banks.map((b) => ({
      key: b.id, href: `/banking/${b.id}`, badge: b.subtype === "cash" ? "CS" : "BA", tone: "bg-[#3d4a7a]",
      title: b.name, holder: `${b.code} · ${b.subtype === "cash" ? "Cash" : "Bank account"}${b.currency !== "MVR" ? ` · ${b.currency}` : ""}`,
      note: b.description ?? "Balance in the books", balance: b.balance,
    })),
  ];
  const directors = people.filter((p) => p.kind === "director"), lenders = people.filter((p) => p.kind === "lender");
  const sum = (xs: { balance: bigint }[]) => xs.reduce((t, x) => t + x.balance, 0n);

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Accounts" subtitle="The company's, the directors' and the lenders' accounts. Open one to see it in detail."
        action={canWrite(s.role) ? <NewAccountButton directors={directors.map((d) => ({ id: d.id, name: d.name }))} /> : undefined} />
      <Section title="Company accounts" total={sum(banks)} rows={companyRows} empty="No company accounts yet." />
      <Section title="Directors' accounts" total={sum(directors)} rows={directors.map(person)} empty="No directors yet." />
      <Section title="Lenders' accounts" total={sum(lenders)} rows={lenders.map(person)} empty="No lenders yet." />
    </div>
  );
}
