import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardHeader, Empty, PageHeader, Table, Th, Td } from "@/components/ui";
import { canWrite, getSession, type Session } from "@/server/session";
import { deletedDocs } from "@/server/deleted-docs";
import { DeleteFinancingButton } from "@/components/partners/delete-financing";
import { EditFinancingButton } from "@/components/partners/edit-financing";
import { addDays, date, money, pct, titleize, today } from "@/lib/format";
import { dbToLaari, laariToNumber, percentOf } from "@/lib/money";
import { docStatus, type DocBalance } from "@/lib/doc-status";
import { type ProjectFigures } from "@/lib/project-figures";
import { VariationRows, NewVariation, type VariationRow } from "./variation-forms";
import { BillingPlan, type Stage } from "./billing-plan";
import { ProjectMenu } from "./project-menu";
import { StageBadge } from "@/components/projects/stage-badge";
import { CompleteForm, FinancingForm } from "@/components/partners/forms";
import { COMPONENT_LABEL, COMPONENTS, type StatementRow } from "@/lib/partners";
import { ProjectBills } from "@/components/projects/project-bills";
import { BillStatusMenu, MarkAllPaid } from "@/components/projects/bill-status";
import { DeleteBillButton, RestoreBillButton } from "@/components/projects/bill-bin";
import { expenseFormData } from "@/server/expense-data";
import { standardGstRate } from "@/server/gst-rate";
import { blankExpense } from "@/lib/expense-doc";

export const dynamic = "force-dynamic";

const m = (v: number | string | null | undefined) => money(laariToNumber(dbToLaari(v)));
const TABS: [string, string][] = [["overview", "Overview"], ["variations", "Variations"], ["bills", "Expenses"], ["billing", "Billing plan"], ["financing", "Financing"], ["split", "Profit split"], ["payouts", "Payouts"], ["transactions", "Transactions"]];

export default async function ProjectPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; new?: string; lender?: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ id }, { tab, new: openNew, lender }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: f } = await s.supabase.from("project_list_v").select("*").eq("id", id).maybeSingle();
  if (!f) notFound();
  const p = f as ProjectFigures;
  const active = TABS.some(([k]) => k === tab) ? tab! : "overview";
  const writer = canWrite(s.role);

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <Link href="/projects" className="text-xs text-[var(--muted)] hover:underline">← Projects</Link>
      </div>
      <PageHeader title={p.name}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">{`${p.code}${p.customer_name ? ` · ${p.customer_name}` : ""}`}<StageBadge stage={p.stage} /></span>}
        action={writer ? <ProjectMenu id={id} code={p.code} archived={Boolean(p.archived_at)} canUndoCompletion={s.role === "admin" && Boolean(p.completed_at)} canDelete={s.role === "admin"} /> : undefined} />

      {/* tabs: only the open one is underlined; the row scrolls on a phone without showing a scrollbar */}
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/projects/${id}?tab=${k}`} aria-current={active === k ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${active === k
              ? "border-neutral-900! font-semibold text-neutral-900"
              : "border-transparent! text-[var(--muted)] hover:text-[var(--text)]"}`}>{l}</Link>
        ))}
      </div>

      {active === "overview" && <Overview s={s} p={p} />}
      {active === "variations" && <Variations s={s} p={p} writer={writer} />}
      {active === "billing" && <Billing s={s} p={p} writer={writer} />}
      {active === "financing" && <Financing s={s} p={p} writer={writer} lender={lender} />}
      {active === "split" && <Split s={s} p={p} writer={writer} />}
      {active === "payouts" && <Payouts s={s} p={p} />}
      {active === "bills" && <Bills s={s} p={p} writer={writer} openNew={openNew === "bill"} />}
      {active === "transactions" && <Transactions s={s} id={id} />}
    </div>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "good" }) {
  return (
    <Card className="stat px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={`mt-2 text-xl font-semibold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-700" : ""}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
    </Card>
  );
}

async function Overview({ s, p }: { s: Session; p: ProjectFigures }) {
  const [rate, { data: lines }] = await Promise.all([
    projectGstRate(s, p.id),
    // the GST charged on the project's invoices (less credit notes), to show billing as the client sees it
    s.supabase.from("transaction_lines").select("tax_amount, transactions!inner(type, voided_at, is_draft)").eq("project_id", p.id)
      .in("transactions.type", ["invoice", "sales_receipt", "credit_note"]).is("transactions.voided_at", null).eq("transactions.is_draft", false),
  ]);
  const gstBilled = ((lines ?? []) as unknown as { tax_amount: string | null; transactions: { type: string } }[])
    .reduce((t, l) => t + dbToLaari(l.tax_amount) * (l.transactions.type === "credit_note" ? -1n : 1n), 0n);
  const withGst = (v: number) => laariToNumber(dbToLaari(v) + percentOf(dbToLaari(v), rate));
  const gst = rate !== "0";
  const beforeGst = (v: number) => gst ? `${m(v)} before GST` : "No GST on this project";
  const profit = dbToLaari(p.actual_profit);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Figure label={gst ? "Contract value (incl. GST)" : "Contract value"} value={money(withGst(p.revised))} hint={beforeGst(p.revised)} />
        <Figure label="Profit" value={m(p.actual_profit)} tone={profit < 0n ? "bad" : undefined}
          hint={`Billed before GST, less cost to date${dbToLaari(p.bad_debts) ? ` and ${m(p.bad_debts)} written off` : ""}`} />
        <Figure label="Cost to date" value={m(p.cost_to_date)} hint="Receipts and costs on this project" />
        <Figure label={gst ? "Variations (incl. GST)" : "Variations"} value={money(withGst(p.variations))} hint={`Original contract ${money(withGst(p.original))}`} />
        <Figure label={gst ? "Billed (incl. GST)" : "Billed"} value={money(laariToNumber(dbToLaari(p.billed) + gstBilled))}
          hint={`${pct(Number(p.billed_pct), 1)} of the contract · ${beforeGst(p.billed)}`} />
        <Figure label="Collected" value={m(p.collected)} hint={`Client owes ${m(p.client_balance)}${dbToLaari(p.retention_held) ? ` · retention ${m(p.retention_held)}` : ""}`} />
      </div>
      {(p.start_date || p.end_date) && (
        <p className="text-xs text-[var(--muted)]">{p.start_date ? `Started ${date(p.start_date)}.` : ""}{p.end_date ? ` Due to finish ${date(p.end_date)}.` : ""}</p>
      )}
    </div>
  );
}

async function Variations({ s, p, writer }: { s: Session; p: ProjectFigures; writer: boolean }) {
  const { data } = await s.supabase.from("variations")
    .select("id, number, ref, title, description, status, amount, raised_date, approved_date, time_impact_days, client_reference")
    .eq("project_id", p.id).order("number");
  const rows = (data ?? []) as VariationRow[];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Figure label="Original contract" value={m(p.original)} />
        <Figure label="Approved variations" value={m(p.variations)} />
        <Figure label="Revised contract" value={m(p.revised)} />
      </div>
      {writer && <NewVariation projectId={p.id} />}
      <Card>
        <CardHeader title="Variations register" subtitle="Only approved variations change the contract value" />
        {rows.length === 0 ? <Empty message="No variations raised." /> : <VariationRows projectId={p.id} rows={rows} canEdit={writer} />}
      </Card>
    </div>
  );
}

/** The GST rate the project's work is invoiced at: standard when the project carries GST or the company is registered (036), else 0. */
async function projectGstRate(s: Session, projectId: string) {
  const [{ data: proj }, { data: settings }, rate] = await Promise.all([
    s.supabase.from("projects").select("gst_amount").eq("id", projectId).maybeSingle(),
    s.supabase.from("settings").select("gst_registered").maybeSingle(),
    standardGstRate(s.supabase),
  ]);
  return settings?.gst_registered || dbToLaari(proj?.gst_amount) > 0n ? rate : "0";
}

async function Billing({ s, p, writer }: { s: Session; p: ProjectFigures; writer: boolean }) {
  const [{ data }, gstRate] = await Promise.all([
    s.supabase.from("billing_stages").select("id, name, basis, value, due_event, invoice_id, sort_order").eq("project_id", p.id).order("sort_order"),
    projectGstRate(s, p.id),
  ]);
  // an invoiced stage counts at what its invoice actually says, which may have been changed after it was raised
  const ids = (data ?? []).map((st) => st.invoice_id).filter(Boolean) as string[];
  // before GST, as the stage itself is
  const [{ data: invs }, { data: owed }] = ids.length ? await Promise.all([
    s.supabase.from("transactions").select("id, voided_at, transaction_lines(amount, tax_amount)").in("id", ids),
    // its number and what has been paid on it, for deleting it from here
    s.supabase.from("document_balances_v").select("id, number, applied").in("id", ids),
  ]) : [{ data: [] }, { data: [] }];
  const paidOn = new Map(((owed ?? []) as { id: string; number: string | null; applied: number }[]).map((d) => [d.id, d]));
  const sumOf = (ls: { amount: string; tax_amount: string | null }[], k: "amount" | "tax_amount") => String(laariToNumber(ls.reduce((t, l) => t + dbToLaari(l[k]), 0n)));
  const invoiced = new Map((invs ?? []).filter((i) => !i.voided_at).map((i) => {
    const ls = (i.transaction_lines ?? []) as { amount: string; tax_amount: string | null }[];
    return [i.id as string, { net: sumOf(ls, "amount"), gst: sumOf(ls, "tax_amount") }];
  }));
  const stages = ((data ?? []) as Stage[]).map((st) => {
    const inv = st.invoice_id ? invoiced.get(st.invoice_id) : undefined;
    const doc = st.invoice_id ? paidOn.get(st.invoice_id) : undefined;
    return { ...st, invoice_total: inv?.net ?? null, invoice_gst: inv?.gst ?? null, invoice_number: doc?.number ?? null, invoice_paid: Number(doc?.applied ?? 0) };
  });
  // how much of the contract is still to come from the client: to invoice, and to receive
  // still to come = what is not invoiced yet (with its GST) + what the client owes on invoices (with theirs)
  const withGst = (v: bigint) => v + percentOf(v, gstRate);
  const toReceive = withGst(dbToLaari(p.remaining_to_bill)) + dbToLaari(p.client_balance);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Contract value" value={m(p.revised)} hint={[dbToLaari(p.variations) ? `incl. variations ${m(p.variations)}` : "",
          gstRate !== "0" ? `+ GST ${Number(gstRate)}% ${money(laariToNumber(percentOf(dbToLaari(p.revised), gstRate)))} = ${money(laariToNumber(withGst(dbToLaari(p.revised))))}` : ""].filter(Boolean).join(" · ") || undefined} />
        <Figure label="Invoiced (before GST)" value={m(p.billed)} hint={`Still to invoice ${m(p.remaining_to_bill)}`} />
        <Figure label="Received from client" value={m(p.collected)} hint={`Payments, GST included · client owes ${m(p.client_balance)} on invoices`} />
        <Figure label="Still to receive" value={money(laariToNumber(toReceive))} hint={`Not invoiced yet${gstRate !== "0" ? " with its GST" : ""}, plus what the client owes on invoices`} />
      </div>
      <BillingPlan projectId={p.id} revised={String(p.revised)} stages={stages} canEdit={writer} gstRate={gstRate} />
    </div>
  );
}

async function Transactions({ s, id }: { s: Session; id: string }) {
  // documents headed to the project, and any whose lines post to it
  const [{ data: byHeader }, { data: byLine }] = await Promise.all([
    s.supabase.from("transactions").select("id").eq("project_id", id),
    s.supabase.from("journal_lines").select("transaction_id").eq("project_id", id),
  ]);
  const ids = [...new Set([...(byHeader ?? []).map((r) => r.id), ...(byLine ?? []).map((r) => r.transaction_id)])];
  const [{ data }, deleted] = await Promise.all([
    ids.length
      ? s.supabase.from("document_balances_v").select("id, type, number, date, due_date, total, applied, balance, is_draft, sent_at, voided_at, contact_id").in("id", ids).order("date", { ascending: false })
      : Promise.resolve({ data: [] }),
    deletedDocs(s),
  ]);
  const t = today();
  const rows = ((data ?? []) as (DocBalance & { id: string; number: string | null; date: string })[]).filter((r) => !deleted.has(r.id));
  return (
    <Card>
      {rows.length === 0 ? <Empty message="Nothing has been posted to this project yet." /> : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Type</Th><Th>No.</Th><Th right>Total</Th><Th right>Status</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.voided_at ? "text-[var(--muted)] line-through" : ""}>
                <Td className="whitespace-nowrap">{date(r.date)}</Td>
                <Td>{titleize(r.type)}</Td>
                <Td className="font-mono text-xs">{r.number ?? "—"}</Td>
                <Td right>{m(r.total)}</Td>
                <Td right><Badge value={docStatus(r, t)} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function Financing({ s, p, writer, lender }: { s: Session; p: ProjectFigures; writer: boolean; lender?: string }) {
  const [{ data: sources }, { data: contacts }, { data: banks }, { data: txns }, { data: company }, { data: capital }] = await Promise.all([
    s.supabase.from("project_financing_v").select("contact_id, source_type, received, repaid, outstanding").eq("project_id", p.id),
    s.supabase.from("contacts").select("id, name, kinds, profit_percent").or("kinds.cs.{partner},kinds.cs.{lender}").eq("active", true).order("name"),
    s.supabase.from("accounts").select("id, code, name").in("subtype", ["bank", "cash"]).eq("active", true).order("code"),
    s.supabase.from("transactions").select("id, date, due_date, number, type, contact_id, bank_account_id, total_amount, reference, voided_at")
      .eq("project_id", p.id).in("type", ["loan_receipt", "capital_contribution"]).order("date"),
    s.supabase.rpc("company_funding", { p_project: p.id }),
    // only an admin finances from the Capital Pool, so only an admin is shown what it holds
    s.role === "admin" ? s.supabase.rpc("company_capital_available") : Promise.resolve({ data: null }),
  ]);
  const names = new Map((contacts ?? []).map((c) => [c.id, c.name]));
  const rows = (sources ?? []).filter((r) => dbToLaari(r.received) !== 0n).sort((a, b) => Number(dbToLaari(b.received) - dbToLaari(a.received)));
  // the company's own financing shares the pool's return by amount too, and comes back to it once the client has paid in full
  const own = dbToLaari(company as string | number | null);
  const ownBack = p.completed_at && dbToLaari(p.client_balance) === 0n ? own : 0n;
  const total = rows.reduce((t, r) => t + dbToLaari(r.received), 0n) + own;
  const ratio = (v: number | string) => total > 0n ? Number((dbToLaari(v) * 1000000n) / total) / 10000 : 0;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Financing sources" subtitle="The contribution ratio (amount ÷ total financing) divides the financing pool's share of profit (§5, P4)" />
        {rows.length === 0 && own === 0n ? <Empty message="No financing recorded. Without financing the pool's share stays with the company (I3)." /> : (
          <Table>
            <thead><tr><Th>Source</Th><Th>Type</Th><Th right>Received</Th><Th right>Ratio</Th><Th right>Repaid</Th><Th right>Outstanding</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.contact_id}>
                  <Td><Link href={`/partners/${r.contact_id}`} className="text-[var(--brand)] hover:underline">{names.get(r.contact_id) ?? "—"}</Link></Td>
                  <Td>{r.source_type === "external" ? <Link href="/partners/lenders" className="hover:underline">Lender</Link> : "Capital Pool"}</Td>
                  <Td right>{m(r.received)}</Td><Td right>{pct(ratio(r.received), 2)}</Td><Td right>{m(r.repaid)}</Td><Td right>{m(r.outstanding)}</Td>
                </tr>
              ))}
              {own > 0n && (
                <tr>
                  <Td>Company</Td><Td>Capital Pool (company&apos;s own)</Td><Td right>{money(laariToNumber(own))}</Td><Td right>{pct(Number((own * 1000000n) / total) / 10000, 2)}</Td>
                  <Td right>{money(laariToNumber(ownBack))}</Td><Td right>{money(laariToNumber(own - ownBack))}</Td>
                </tr>
              )}
              <tr className="font-semibold"><Td>Total</Td><Td> </Td><Td right>{money(laariToNumber(total))}</Td><Td right>100%</Td>
                <Td right>{money(laariToNumber(rows.reduce((t, r) => t + dbToLaari(r.repaid), 0n) + ownBack))}</Td>
                <Td right>{money(laariToNumber(rows.reduce((t, r) => t + dbToLaari(r.outstanding), 0n) + own - ownBack))}</Td></tr>
            </tbody>
          </Table>
        )}
      </Card>
      {writer && !p.completed_at && (
        <Card>
          <CardHeader title="Add Funds" />
          <FinancingForm projectId={p.id} banks={banks ?? []} initialLender={lender}
            lenders={(contacts ?? []).filter((c) => (c.kinds as string[]).includes("lender"))}
            partners={(contacts ?? []).filter((c) => (c.kinds as string[]).includes("partner"))}
            capital={(capital as { contact_id: string | null; name: string; available: string | number }[] | null)?.map((c) => ({ contact_id: c.contact_id, name: c.name, available: String(c.available) })) ?? null} />
        </Card>
      )}
      {(txns ?? []).some((t) => !t.voided_at) && (
        <Card>
          <CardHeader title="Funding history" />
          <Table>
            <thead><tr><Th>Date</Th><Th>No.</Th><Th>From</Th><Th>Reference</Th><Th right>Amount</Th>{writer && <Th>{""}</Th>}</tr></thead>
            <tbody>
              {(txns ?? []).filter((t) => !t.voided_at).map((t) => (
                <tr key={t.id}>
                  <Td className="whitespace-nowrap">{date(t.date)}</Td><Td className="font-mono text-xs">{t.number}</Td>
                  <Td>{names.get(t.contact_id!) ?? "—"}</Td><Td>{t.reference ?? ""}</Td><Td right>{m(t.total_amount)}</Td>
                  {writer && <Td right className="w-24 whitespace-nowrap py-1">
                    {(t.type === "loan_receipt" || t.type === "capital_contribution") && (
                      <EditFinancingButton projectId={p.id} entry={t} banks={banks ?? []}
                        who={(contacts ?? []).filter((c) => (c.kinds as string[]).includes(t.type === "loan_receipt" ? "lender" : "partner"))} />
                    )}
                    <DeleteFinancingButton id={t.id} number={t.number} />
                  </Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

async function Split({ s, p, writer }: { s: Session; p: ProjectFigures; writer: boolean }) {
  if (!p.completed_at) {
    const [{ data: profit }, { data: preview }, { data: proj }, { data: company }] = await Promise.all([
      s.supabase.rpc("project_profit", { p_project: p.id }),
      s.supabase.rpc("preview_split", { p_project: p.id }),
      s.supabase.from("projects").select("profit_schemes(name, effective_from)").eq("id", p.id).maybeSingle(),
      s.supabase.rpc("company_funding", { p_project: p.id }),
    ]);
    const lines = (preview ?? []) as { contact_id: string; name: string; component: string; amount: string; principal: string }[];
    const shared = lines.reduce((t, l) => t + dbToLaari(l.amount), 0n);
    const profitL = dbToLaari(profit as string | number | null);
    const own = dbToLaari(company as string | number | null);
    const ownReturn = own > 0n && profitL > 0n
      ? dbToLaari((await s.supabase.rpc("company_financing_return", { p_project: p.id, p_profit: laariToNumber(profitL) })).data as string | number | null) : 0n;
    const scheme = (proj?.profit_schemes ?? null) as unknown as { name: string; effective_from: string } | null;
    const people = [...new Set(lines.map((l) => l.contact_id))];
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader title="Split preview" subtitle={`If completed now, on the profit to date${scheme ? ` · ${scheme.name} (from ${date(scheme.effective_from)})` : ""}`} />
          {profitL <= 0n ? <Empty message={`Profit to date is ${money(laariToNumber(profitL))}: nothing is shared on a loss or zero profit, and principal is still repaid in full (P2).`} /> : (
            <Table>
              <thead><tr><Th>Party</Th><Th right>Principal back</Th><Th right>Financing return</Th><Th right>Profit share</Th><Th right>Total</Th></tr></thead>
              <tbody>
                {people.map((cid) => {
                  const get = (c: string) => lines.filter((l) => l.contact_id === cid && l.component === c).reduce((t, l) => t + dbToLaari(l.amount), 0n);
                  const principal = dbToLaari(lines.find((l) => l.contact_id === cid)?.principal);
                  return (
                    <tr key={cid}>
                      <Td>{lines.find((l) => l.contact_id === cid)?.name}</Td>
                      <Td right>{principal ? money(laariToNumber(principal)) : "–"}</Td>
                      <Td right>{get("financing_return") ? money(laariToNumber(get("financing_return"))) : "–"}</Td>
                      <Td right>{get("profit_share") ? money(laariToNumber(get("profit_share"))) : "–"}</Td>
                      <Td right className="font-medium">{money(laariToNumber(principal + get("financing_return") + get("profit_share")))}</Td>
                    </tr>
                  );
                })}
                {own > 0n && (
                  <tr>
                    <Td>Company (its own financing)</Td><Td right>{money(laariToNumber(own))}</Td><Td right>{money(laariToNumber(ownReturn))}</Td>
                    <Td right>–</Td><Td right className="font-medium">{money(laariToNumber(own + ownReturn))}</Td>
                  </tr>
                )}
                <tr><Td>Company keeps</Td><Td right> </Td><Td right> </Td><Td right>{money(laariToNumber(profitL - shared - ownReturn))}</Td><Td right> </Td></tr>
                <tr className="font-semibold"><Td>Project profit</Td><Td right> </Td><Td right> </Td><Td right>{money(laariToNumber(profitL))}</Td><Td right> </Td></tr>
              </tbody>
            </Table>
          )}
        </Card>
        {writer && (
          <Card>
            <CardHeader title="Complete the project" subtitle="Posts Dr Finance Cost and Dr Profit Share against each person's payables. Payouts wait until the client owes nothing." />
            <CompleteForm projectId={p.id} profit={money(laariToNumber(profitL))} />
          </Card>
        )}
      </div>
    );
  }
  const [{ data: dists }, { data: flag }, { data: contacts }, { data: company }] = await Promise.all([
    s.supabase.from("distributions").select("id, created_at, reason, profit_amount, distribution_lines(contact_id, component, amount)").eq("project_id", p.id).order("created_at"),
    s.supabase.from("projects").select("review_flag").eq("id", p.id).maybeSingle(),
    s.supabase.from("contacts").select("id, name"),
    s.supabase.rpc("company_funding", { p_project: p.id }),
  ]);
  const names = new Map((contacts ?? []).map((c) => [c.id, c.name]));
  const all = (dists ?? []).flatMap((d) => (d.distribution_lines ?? []) as { contact_id: string; component: string; amount: string }[]);
  const people = [...new Set(all.map((l) => l.contact_id))].sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? ""));
  const net = (cid: string, c: string) => all.filter((l) => l.contact_id === cid && l.component === c).reduce((t, l) => t + dbToLaari(l.amount), 0n);
  const latest = (dists ?? []).at(-1);
  // the company's own financing earns its share of the pool like everyone's; it is not posted, it stays with the company
  const own = dbToLaari(company as string | number | null);
  const ownReturn = own > 0n && latest
    ? dbToLaari((await s.supabase.rpc("company_financing_return", { p_project: p.id, p_profit: latest.profit_amount })).data as string | number | null) : 0n;
  const REASON: Record<string, string> = { completion: "On completion", bad_debt: "Bad debt", late_entry: "Late entry", manual: "Adjustment" };
  return (
    <div className="space-y-5">
      {flag?.review_flag && <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">For review: {flag.review_flag}.</p>}
      <Card>
        <CardHeader title="Profit split" subtitle={`Completed ${date(p.completed_at)} · current profit ${m(latest?.profit_amount)} · net of every adjustment`} />
        {people.length === 0 && ownReturn === 0n ? <Empty message="Nothing shared: the project made no profit." /> : (
          <Table>
            <thead><tr><Th>Person</Th><Th right>Financing return</Th><Th right>Profit share</Th></tr></thead>
            <tbody>
              {people.map((cid) => (
                <tr key={cid}>
                  <Td><Link href={`/partners/${cid}`} className="text-[var(--brand)] hover:underline">{names.get(cid) ?? "—"}</Link></Td>
                  <Td right>{money(laariToNumber(net(cid, "financing_return")))}</Td><Td right>{money(laariToNumber(net(cid, "profit_share")))}</Td>
                </tr>
              ))}
              {latest && (() => {
                // the company keeps whatever is not shared out: its financing return on its own money, and the rest of the profit
                const kept = dbToLaari(latest.profit_amount) - all.reduce((t, l) => t + dbToLaari(l.amount), 0n);
                return kept > 0n && (
                  <tr className="font-medium">
                    <Td>Company (stays in the company, not paid out)</Td>
                    <Td right>{ownReturn > 0n ? money(laariToNumber(ownReturn)) : "–"}</Td>
                    <Td right>{money(laariToNumber(kept - ownReturn))}</Td>
                  </tr>
                );
              })()}
              {latest && (
                <tr className="font-semibold"><Td>Project profit</Td><Td right> </Td>
                  <Td right>{m(latest.profit_amount)}</Td></tr>
              )}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title="Entries" subtitle="The original split is never edited; each change is its own entry" />
        <Table>
          <thead><tr><Th>Posted</Th><Th>Why</Th><Th right>Profit</Th><Th right>Shared</Th></tr></thead>
          <tbody>
            {(dists ?? []).map((d) => (
              <tr key={d.id}>
                <Td>{date(d.created_at)}</Td><Td>{REASON[d.reason] ?? d.reason}</Td><Td right>{m(d.profit_amount)}</Td>
                <Td right>{money(laariToNumber(((d.distribution_lines ?? []) as { amount: string }[]).reduce((t, l) => t + dbToLaari(l.amount), 0n)))}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

async function Payouts({ s, p }: { s: Session; p: ProjectFigures }) {
  const [{ data: status }, { data: statement }, { data: contacts }] = await Promise.all([
    s.supabase.rpc("payout_status", { p_project: p.id }).maybeSingle(),
    s.supabase.from("partner_statement_v").select("contact_id, project_id, component, accrued, paid, outstanding").eq("project_id", p.id),
    s.supabase.from("contacts").select("id, name"),
  ]);
  const st = status as { blocked: boolean; reason: string | null; client_owes: number } | null;
  const names = new Map((contacts ?? []).map((c) => [c.id, c.name]));
  const rows = (statement ?? []) as StatementRow[];
  const people = [...new Set(rows.map((r) => r.contact_id))].sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? ""));
  const get = (cid: string, c: string) => rows.find((r) => r.contact_id === cid && r.component === c);
  return (
    <div className="space-y-5">
      {st?.blocked ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900">Payouts are blocked: {st.reason}.
          {dbToLaari(st.client_owes) > 0n && p.customer_id && <> <Link href={`/sales/customers/${p.customer_id}`} className="font-medium underline">See what the client owes</Link>.</>}</p>
      ) : <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">Payouts are released: the project is completed and the client owes nothing.</p>}
      <Card>
        <CardHeader title="Owed on this project" subtitle="Pay from each person's statement" />
        {people.length === 0 ? <Empty message="Nothing owed on this project." /> : (
          <Table>
            <thead><tr><Th>Person</Th>{COMPONENTS.map((c) => <Th key={c} right>{COMPONENT_LABEL[c]} (paid / owed)</Th>)}<Th right> </Th></tr></thead>
            <tbody>
              {people.map((cid) => (
                <tr key={cid}>
                  <Td>{names.get(cid) ?? "—"}</Td>
                  {COMPONENTS.map((c) => { const r = get(cid, c); return <Td key={c} right>{r ? `${m(r.paid)} / ${m(r.outstanding)}` : "–"}</Td>; })}
                  <Td right><Link href={`/partners/${cid}`} className="text-sm font-medium text-[var(--brand)] hover:underline">Statement</Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

async function Bills({ s, p, writer, openNew }: { s: Session; p: ProjectFigures; writer: boolean; openNew: boolean }) {
  // bills headed to the project, and bills with a line charged to it
  const [{ data: byHead }, { data: byLine }] = await Promise.all([
    s.supabase.from("transactions").select("id").eq("project_id", p.id).in("type", ["bill", "vendor_credit", "expense"]),
    s.supabase.from("transaction_lines").select("transaction_id, transactions!inner(type)").eq("project_id", p.id).in("transactions.type", ["bill", "vendor_credit", "expense"]),
  ]);
  const ids = [...new Set([...(byHead ?? []).map((r) => r.id), ...(byLine ?? []).map((r) => r.transaction_id)])];
  const [{ data }, { data: what }, { data: bin }, form] = await Promise.all([
    ids.length ? s.supabase.from("document_balances_v").select("id, type, number, date, due_date, total, applied, balance, is_draft, sent_at, voided_at, contact_id").in("id", ids).order("date", { ascending: false })
      : Promise.resolve({ data: [] }),
    // what each cost was for, for those with no vendor (transport, salary, …)
    ids.length ? s.supabase.from("transactions").select("id, memo, transaction_lines(description, accounts(name))").in("id", ids) : Promise.resolve({ data: [] }),
    // deleted ones leave the list; those deleted in the last 30 days can be restored
    ids.length ? s.supabase.from("bill_bin").select("bill_id, deleted_at").in("bill_id", ids) : Promise.resolve({ data: [] }),
    writer ? expenseFormData(s) : Promise.resolve(null),
  ]);
  const binned = new Map(((bin ?? []) as { bill_id: string; deleted_at: string }[]).map((b) => [b.bill_id, b.deleted_at.slice(0, 10)]));
  const all = (data ?? []) as (DocBalance & { id: string; type: string; number: string | null; date: string; total: number; balance: number; contact_id: string | null })[];
  const rows = all.filter((r) => !binned.has(r.id));
  const t = today();
  const restorable = all.filter((r) => binned.has(r.id) && addDays(binned.get(r.id)!, 30) >= t);
  const { data: vendors } = all.length ? await s.supabase.from("contacts").select("id, name").in("id", [...new Set(all.map((r) => r.contact_id).filter(Boolean))] as string[]) : { data: [] };
  const vn = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const forWhat = new Map((what ?? []).map((w) => {
    const l = ((w.transaction_lines ?? []) as unknown as { description: string | null; accounts: { name: string } | null }[])[0];
    return [w.id as string, [l?.accounts?.name, l?.description || w.memo].filter(Boolean).join(" · ")];
  }));
  const live = rows.filter((r) => !r.voided_at);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Figure label="Receipts and costs on this project" value={String(live.length)} />
        <Figure label="Total cost to the project" value={m(live.reduce((x, r) => x + Number(r.total) * (r.type === "vendor_credit" ? -1 : 1), 0))} hint="Including GST" />
        <Figure label="Still to pay" value={m(live.filter((r) => r.type === "bill").reduce((x, r) => x + Number(r.balance), 0))} />
      </div>
      {writer && form && <ProjectBills projectId={p.id} data={form} blank={blankExpense("bill", "", p.id, form)} openNew={openNew} />}
      <Card>
        <CardHeader title="Receipts and other costs" subtitle="Click one to open it. Overdue: not paid yet and past its due date; pick from its status to mark it paid."
          action={writer ? <div className="flex gap-2">
            <Link href={`/expenses/new?type=expense&project=${p.id}`} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--hover)]">+ Other cost (no vendor)</Link>
            {form && <MarkAllPaid projectId={p.id} payFrom={form.payFrom}
              billIds={live.filter((r) => r.type === "bill" && Number(r.balance) > 0 && !r.is_draft).map((r) => r.id)} />}
          </div> : undefined} />
        {rows.length === 0 ? <Empty message="No receipts or costs on this project yet." /> : (
          <Table>
            <thead><tr><Th>Date</Th><Th>No.</Th><Th>Vendor / for</Th><Th>Due</Th><Th right>Total</Th><Th right>To pay</Th><Th right>Status</Th>{writer && <Th><span className="sr-only">Delete</span></Th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.voided_at ? "text-[var(--muted)] line-through" : ""}>
                  <Td className="whitespace-nowrap">{date(r.date)}</Td>
                  <Td><Link href={`/expenses/${r.id}`} className="font-mono text-xs text-[var(--brand)] hover:underline">{r.number ?? "—"}</Link>{r.type === "vendor_credit" && <span className="ml-1 text-xs text-[var(--muted)]">credit</span>}</Td>
                  <Td>{vn.get(r.contact_id ?? "") ?? <span className="text-[var(--muted)]">{forWhat.get(r.id) || "—"}</span>}</Td>
                  <Td className="whitespace-nowrap">{r.due_date ? date(r.due_date) : ""}</Td>
                  <Td right>{m(r.total)}</Td>
                  <Td right>{Number(r.balance) ? m(r.balance) : ""}</Td>
                  <Td right>{writer && form && !r.voided_at && !r.is_draft && r.type === "bill" && Number(r.balance) > 0
                    ? <BillStatusMenu projectId={p.id} billId={r.id} label={docStatus(r, t)} payFrom={form.payFrom} />
                    : <Badge value={docStatus(r, t)} />}</Td>
                  {writer && <Td right className="whitespace-nowrap">{!r.voided_at && <>
                    <Link href={`/expenses/${r.id}/edit`} aria-label={`Edit ${r.number ?? "receipt"}`} title="Edit"
                      className="relative z-[1] inline-flex rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]">
                      <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                    </Link>
                    <DeleteBillButton billId={r.id} number={r.number} />
                  </>}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {restorable.length > 0 && (
        <Card>
          <CardHeader title="Deleted receipts" subtitle="Kept for 30 days after deleting; restoring one puts it back with its payment." />
          <Table>
            <thead><tr><Th>Date</Th><Th>No.</Th><Th>Vendor / for</Th><Th right>Total</Th><Th>Deleted</Th><Th>Restore until</Th>{writer && <Th><span className="sr-only">Restore</span></Th>}</tr></thead>
            <tbody>
              {restorable.map((r) => (
                <tr key={r.id} className="text-[var(--muted)]">
                  <Td className="whitespace-nowrap">{date(r.date)}</Td>
                  <Td><span className="font-mono text-xs">{r.number ?? "—"}</span></Td>
                  <Td>{vn.get(r.contact_id ?? "") ?? (forWhat.get(r.id) || "—")}</Td>
                  <Td right>{m(r.total)}</Td>
                  <Td className="whitespace-nowrap">{date(binned.get(r.id)!)}</Td>
                  <Td className="whitespace-nowrap">{date(addDays(binned.get(r.id)!, 30))}</Td>
                  {writer && <Td right><RestoreBillButton billId={r.id} /></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
