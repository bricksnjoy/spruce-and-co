import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, Empty, PageHeader, Stat, Table, Th, Td } from "@/components/ui";
import { PayoutApproval } from "@/components/partners/forms";
import { DirectorAccountActions, PoolRepayButton, SettleButton } from "@/components/partners/settle";
import { RecordLoan } from "@/components/partners/record-loan";
import { ReviewButtons } from "@/components/contacts/review-buttons";
import { canWrite, type Session } from "@/server/session";
import { date, money } from "@/lib/format";
import { dbToLaari, laariToNumber } from "@/lib/money";
import type { StatementRow } from "@/lib/partners";

const m = (v: number | string | bigint | null | undefined) => money(laariToNumber(typeof v === "bigint" ? v : dbToLaari(v ?? 0)));
const str = (v: bigint) => laariToNumber(v).toFixed(2);

type Proj = { id: string; code: string; name: string; completed_at: string | null; client_owes: string | number | null; principal_outstanding: string | number | null };
type Line = { project_id: string | null; component: string | null; amount: string | number };
type Txn = {
  id: string; date: string; number: string | null; type: string; project_id: string | null; total_amount: string | number; reference: string | null;
  memo: string | null; is_draft: boolean; voided_at: string | null; void_reason: string | null; bank_account_id: string | null; transaction_lines: Line[];
};

/**
 * One partner's or lender's page, in the order money moves: what they lent,
 * repaying the loan (from the project's money once the client pays, or from the
 * Capital Pool), then their earnings (financing return and profit share), taken
 * out or kept in the company; their director's account; and the history.
 */
export async function Partner({ s, id }: { s: Session; id: string }) {
  const [{ data: person }, { data: statement }, { data: projects }, { data: banks }, { data: txns }, { data: open }] = await Promise.all([
    s.supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
    s.supabase.from("partner_statement_v").select("contact_id, project_id, component, accrued, paid, outstanding").eq("contact_id", id),
    s.supabase.from("project_payouts_v").select("id, code, name, completed_at, client_owes, principal_outstanding"),
    s.supabase.from("accounts").select("id, code, name").in("subtype", ["bank", "cash"]).eq("active", true).order("code"),
    s.supabase.from("transactions").select("id, date, number, type, project_id, total_amount, reference, memo, is_draft, voided_at, void_reason, bank_account_id, transaction_lines(project_id, component, amount)")
      .eq("contact_id", id).in("type", ["loan_receipt", "capital_contribution", "payout", "journal"]).order("date", { ascending: false }).order("created_at", { ascending: false }),
    s.supabase.from("projects").select("id, code, name").is("completed_at", null).is("archived_at", null).order("code"),
  ]);
  if (!person) notFound();
  const kinds = person.kinds as string[];
  const isDirector = kinds.includes("partner"), isLender = kinds.includes("lender");
  const writer = canWrite(s.role), isAdmin = s.role === "admin";

  // their director's account: money kept in the company (039)
  const { data: fundsParent } = isDirector ? await s.supabase.from("accounts").select("id").eq("subtype", "members_funds").is("parent_id", null).maybeSingle() : { data: null };
  const { data: fundsAcct } = fundsParent ? await s.supabase.from("accounts").select("id").eq("parent_id", fundsParent.id).eq("contact_id", id).maybeSingle() : { data: null };
  const { data: inAcct } = isDirector ? await s.supabase.rpc("director_account_balance", { p_contact: id }) : { data: 0 };
  const inAccount = dbToLaari(inAcct as string | number | null);

  const proj = new Map(((projects ?? []) as Proj[]).map((p) => [p.id, p]));
  const rows = (statement ?? []) as StatementRow[];
  const get = (pid: string, c: string, k: "accrued" | "paid" | "outstanding") =>
    rows.filter((r) => r.project_id === pid && r.component === c).reduce((t, r) => t + dbToLaari(r[k]), 0n);

  // each project they are in, with where its loan and earnings stand
  const items = [...new Set(rows.map((r) => r.project_id))].map((pid) => {
    const p = proj.get(pid);
    const clientOwes = dbToLaari(p?.client_owes);
    const finished = Boolean(p?.completed_at);
    const lent = get(pid, "principal", "accrued"), repaid = get(pid, "principal", "paid"), loanLeft = get(pid, "principal", "outstanding");
    const ret = get(pid, "financing_return", "accrued"), share = get(pid, "profit_share", "accrued");
    const earnedLeft = get(pid, "financing_return", "outstanding") + get(pid, "profit_share", "outstanding");
    const earnedPaid = get(pid, "financing_return", "paid") + get(pid, "profit_share", "paid");
    const loansOnProject = dbToLaari(p?.principal_outstanding);
    return { pid, p, clientOwes, finished, lent, repaid, loanLeft, ret, share, earnedLeft, earnedPaid, loansOnProject, done: finished && loanLeft === 0n && earnedLeft === 0n };
  }).sort((a, b) => (a.p?.code ?? "").localeCompare(b.p?.code ?? ""));
  const active = items.filter((i) => !i.done), settled = items.filter((i) => i.done);

  const loansLeft = items.reduce((t, i) => t + i.loanLeft, 0n);
  const earningsLeft = items.reduce((t, i) => t + i.earnedLeft, 0n);
  const paidSoFar = items.reduce((t, i) => t + i.repaid + i.earnedPaid, 0n);

  // what the Capital Pool has, for repaying a loan before the client pays (admin)
  const needsPool = isAdmin && items.some((i) => i.loanLeft > 0n && i.clientOwes !== 0n);
  const { data: capital } = needsPool ? await s.supabase.rpc("company_capital_available") : { data: null };

  const bankList = banks ?? [];
  const projectLink = (pid: string) => {
    const p = proj.get(pid);
    return p ? <Link href={`/projects/${p.id}?tab=split`} className="hover:underline"><span className="font-mono text-xs text-[var(--muted)]">{p.code}</span> <span className="font-semibold">{p.name}</span></Link> : <span>—</span>;
  };
  const chip = (i: (typeof items)[number]) => {
    const [cls, text] = !i.finished ? ["bg-sky-50 text-sky-800", "In progress"]
      : i.clientOwes !== 0n ? ["bg-amber-50 text-amber-800", `Finished · client owes ${m(i.clientOwes)}`]
      : ["bg-emerald-50 text-emerald-800", "Finished · client paid"];
    return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{text}</span>;
  };
  const done = (text: string) => <span className="text-sm font-medium text-emerald-700">✓ {text}</span>;
  const wait = (text: string) => <span className="text-sm text-[var(--muted)]">{text}</span>;

  const step = (n: number, title: string, detail: React.ReactNode, right: React.ReactNode) => (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">{n}</span>
        <div className="min-w-0"><p className="font-medium">{title}</p><div className="text-sm text-[var(--muted)]">{detail}</div></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">{right}</div>
    </div>
  );

  const projectCard = (i: (typeof items)[number]) => {
    const settleProps = { contactId: id, projectId: i.pid, code: i.p?.code ?? "", isDirector, isAdmin, banks: bankList };
    // 1 · the loan
    const loan = i.lent > 0n && step(1, "Loan",
      <>Lent {m(i.lent)} · repaid {m(i.repaid)}{i.loanLeft > 0n && <> · <strong className="whitespace-nowrap text-[var(--text)]">{m(i.loanLeft)} left</strong></>}</>,
      i.loanLeft === 0n ? done("Repaid")
        : i.clientOwes === 0n
          ? (writer ? <>
              <SettleButton {...settleProps} what="principal" owed={str(i.loanLeft)} text={isDirector ? "Pay back" : "Repay loan"} />
              {isDirector && <SettleButton {...settleProps} what="principal" owed={str(i.loanLeft)} start="keep" text="Keep in the company" />}
            </> : wait("Ready to repay"))
          : <>
              {wait(`The client still owes ${m(i.clientOwes)}`)}
              {isAdmin && <PoolRepayButton contactId={id} projectId={i.pid} code={i.p?.code ?? ""} owed={str(i.loanLeft)} capital={(capital ?? []) as { contact_id: string | null; name: string; available: string }[]} banks={bankList} />}
            </>);
    // 2 · the earnings
    const earned = i.ret + i.share;
    const others = i.loansOnProject - i.loanLeft;   // loans to others still owed on this project
    const earnings = step(i.lent > 0n ? 2 : 1, "Earnings",
      !i.finished ? "Financing return and profit share come when the project is finished."
        : earned === 0n ? "No earnings from this project."
        : <>Financing return {m(i.ret)} · profit share {m(i.share)}{i.earnedPaid > 0n && <> · settled {m(i.earnedPaid)}</>}{i.earnedLeft > 0n && <> · <strong className="whitespace-nowrap text-[var(--text)]">{m(i.earnedLeft)} left</strong></>}</>,
      !i.finished || earned === 0n ? null
        : i.earnedLeft === 0n ? done("Settled")
        : i.clientOwes !== 0n ? wait(`Waiting for the client to pay ${m(i.clientOwes)}`)
        : i.loansOnProject > 0n ? wait(i.loanLeft > 0n && others <= 0n ? "Repay the loan first (step 1)" : `Loans on this project are repaid first: ${m(i.loansOnProject)} left`)
        : writer ? <>
            <SettleButton {...settleProps} what="earnings" owed={str(i.earnedLeft)} text="Take it out" />
            {isDirector && <SettleButton {...settleProps} what="earnings" owed={str(i.earnedLeft)} start="keep" text="Keep in the company" />}
          </> : wait("Ready to settle"));
    return (
      <Card key={i.pid} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-3">
          {projectLink(i.pid)}{chip(i)}
        </div>
        <div className="divide-y divide-[var(--border)]">{loan}{earnings}</div>
      </Card>
    );
  };

  // one history of everything between them and the company
  const fundsId = fundsAcct?.id ?? null;
  const history = ((txns ?? []) as unknown as Txn[])
    .filter((t) => t.type !== "journal" || t.reference === "Director's account")
    .map((t) => {
      const code = (pid: string | null) => (pid && proj.get(pid)?.code) || "a project";
      const lines = t.transaction_lines ?? [];
      const loanPart = lines.filter((l) => l.component === "principal").reduce((x, l) => x + dbToLaari(l.amount), 0n);
      const earnPart = lines.filter((l) => l.component !== "principal").reduce((x, l) => x + dbToLaari(l.amount), 0n);
      const where = [...new Set(lines.map((l) => code(l.project_id)))].join(", ");
      const what = t.type === "loan_receipt" ? `Lent to ${code(t.project_id)}`
        : t.type === "capital_contribution" ? (t.reference === "Capital Pool bridge" ? `Put into ${code(t.project_id)} to repay a lender (paid back when the client pays)`
          : fundsId && t.bank_account_id === fundsId ? `Reinvested in ${code(t.project_id)} from the director's account` : `Put into ${code(t.project_id)} (Capital Pool)`)
        : t.type === "journal" ? "Taken out of the director's account"
        : `${fundsId && t.bank_account_id === fundsId ? (t.is_draft ? "To keep in the company" : "Kept in the company") : t.is_draft ? "To pay out" : "Paid out"}: ${[loanPart > 0n && "loan", earnPart > 0n && "earnings"].filter(Boolean).join(" and ")} on ${where}${t.reference === "Capital Pool" ? " (from the Capital Pool)" : ""}`;
      const into = t.type === "loan_receipt" || t.type === "capital_contribution";
      return { t, what, into };
    });

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex gap-3 text-xs text-[var(--muted)]">
        <Link href="/partners" className="hover:underline">← Partners & financing</Link>
        {isLender && <Link href="/partners/lenders" className="hover:underline">← Lenders</Link>}
        <Link href={`/people/accounts/${id}`} className="hover:underline">Account by project</Link>
      </div>
      {(person.needs_review || !person.active) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{!person.active ? "Archived: hidden from lists and pickers." : "Copied from the old lists and not yet confirmed as real. Check the details, then confirm or archive it."}</span>
          {writer && <ReviewButtons id={id} archived={!person.active} />}
        </div>
      )}
      <PageHeader title={person.name} subtitle={isDirector ? (isLender ? "Director · also lends" : "Director") : isLender ? "Lender" : "Contact"} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Loans to repay" value={m(loansLeft)} hint="Lent to projects, not repaid yet" tone={loansLeft > 0n ? "warn" : "default"} />
        <Stat label="Earnings to settle" value={m(earningsLeft)} hint="Financing return and profit share not yet taken out or kept" tone={earningsLeft > 0n ? "warn" : "default"} />
        {isDirector
          ? <Stat label="In director's account" value={m(inAccount)} hint="Kept in the company, ready to reinvest" tone={inAccount > 0n ? "good" : "default"} />
          : <Stat label="Paid so far" value={m(paidSoFar)} hint="Loans repaid and earnings paid" />}
      </div>

      <Card className="px-5 py-4">
        <ol className="grid gap-4 text-sm sm:grid-cols-3">
          {[
            ["Lend", "Money goes into a project as a loan."],
            ["Repay the loan", "From the project's money once the client pays, or from the Capital Pool if it can't wait."],
            ["Settle the earnings", isDirector ? "Financing return and profit share: take it out, or keep it in the company to reinvest." : "Financing return: paid out once the loans on the project are repaid."],
          ].map(([t, d], n) => (
            <li key={t} className="flex gap-3">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-xs font-semibold text-white">{n + 1}</span>
              <span><span className="block font-medium">{t}</span><span className="block text-[var(--muted)]">{d}</span></span>
            </li>
          ))}
        </ol>
      </Card>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Projects</h2>
        {active.length === 0 && <Card><Empty message={items.length ? "Everything is settled." : "Not in any project yet."} /></Card>}
        {active.map(projectCard)}
        {settled.length > 0 && (
          <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <summary className="cursor-pointer px-5 py-3 text-sm font-medium">Settled projects ({settled.length})</summary>
            <div className="space-y-3 px-3 pb-3">{settled.map(projectCard)}</div>
          </details>
        )}
      </section>

      {isDirector && (
        <Card>
          <CardHeader title="Director's account" subtitle="Money they kept in the company. It can be taken out, or reinvested in a project."
            action={isAdmin && person.active ? <DirectorAccountActions contactId={id} inAccount={str(inAccount)} banks={bankList} projects={open ?? []} /> : undefined} />
          <p className="px-5 py-4 text-2xl font-semibold tabular-nums">{m(inAccount)}</p>
        </Card>
      )}

      <Card>
        <CardHeader title="History" subtitle="Everything lent, repaid, paid out and kept, newest first" />
        {history.length === 0 ? <Empty message="Nothing yet." /> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>What</Th><Th right>Amount</Th><Th right>Status</Th></tr></thead>
            <tbody>
              {history.map(({ t, what, into }) => (
                <tr key={t.id} className={t.voided_at ? "text-[var(--muted)]" : ""}>
                  <Td className="whitespace-nowrap">{date(t.date)}</Td>
                  <Td>{what}{t.number && <span className="ml-2 font-mono text-xs text-[var(--muted)]">{t.number}</span>}
                    {t.voided_at && t.void_reason && <span className="block text-xs">Not done: {t.void_reason}</span>}</Td>
                  <Td right className={t.voided_at ? "line-through" : into ? "" : "font-medium"}>{m(t.total_amount)}</Td>
                  <Td right>{t.voided_at ? <Badge value="void" />
                    : t.is_draft && t.type === "payout" ? (writer ? <PayoutApproval id={t.id} isAdmin={isAdmin} /> : <Badge value="awaiting_approval" />)
                    : <span className="text-xs text-emerald-700">Done</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {writer && isLender && person.active && (
        <Card>
          <CardHeader title="Lend to a project" subtitle="Choose the project; its Financing tab opens with this lender picked" />
          <RecordLoan lenderId={id} projects={open ?? []} />
        </Card>
      )}
    </div>
  );
}
