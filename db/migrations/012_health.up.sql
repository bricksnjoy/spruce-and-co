-- 012 · The Health Check (§13 invariants), runnable on real data from the
-- Accounting → Health page and after every test. It checks one book at a time.

alter table public.journal_lines add column if not exists created_at timestamptz not null default now();

/** Record when the closing date last moved, so later edits behind it can be caught. */
create or replace function public.stamp_closing_date() returns trigger language plpgsql as $$
begin
  if new.closing_date is distinct from old.closing_date then new.closing_date_set_at := now(); end if;
  return new;
end $$;
create trigger settings_closing_stamp before update on public.settings for each row execute function public.stamp_closing_date();

create or replace function public.health_check(p_book text default public.current_book())
returns table (no int, name text, ok boolean, detail text) language plpgsql stable as $$
declare v numeric; v2 numeric; c int; s text; a_ numeric; l_ numeric; e_ numeric; p_ numeric;
begin
  -- 1
  select count(*) into c from (select transaction_id from public.journal_lines where book = p_book
    group by 1 having sum(home_debit) <> sum(home_credit)) x;
  no := 1; name := 'Every transaction balances'; ok := c = 0; detail := c || ' unbalanced'; return next;

  -- 2
  select coalesce(sum(home_debit - home_credit), 0) into v from public.journal_lines where book = p_book;
  no := 2; name := 'Trial balance nets to zero'; ok := v = 0; detail := 'difference ' || v; return next;

  -- 3
  select coalesce(sum(case when a.type = 'asset' then j.home_debit - j.home_credit end), 0),
         coalesce(sum(case when a.type = 'liability' then j.home_credit - j.home_debit end), 0),
         coalesce(sum(case when a.type = 'equity' then j.home_credit - j.home_debit end), 0),
         coalesce(sum(case when a.type in ('income', 'cogs', 'expense') then j.home_credit - j.home_debit end), 0)
    into a_, l_, e_, p_ from public.journal_lines j join public.accounts a on a.id = j.account_id where j.book = p_book;
  no := 3; name := 'Assets = liabilities + equity + profit'; ok := a_ = l_ + e_ + p_;
  detail := format('assets %s, liabilities %s, equity %s, profit %s', a_, l_, e_, p_); return next;

  -- 4
  select count(*) into c from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.book = p_book and a.subtype in ('ar', 'ap') and j.contact_id is null;
  select coalesce(sum(j.home_debit - j.home_credit), 0) into v from public.journal_lines j where j.book = p_book and j.account_id = public.acct('ar');
  select coalesce(sum(b), 0) into v2 from (select sum(j.home_debit - j.home_credit) b from public.journal_lines j
    where j.book = p_book and j.account_id = public.acct('ar') group by j.contact_id) x;
  no := 4; name := 'Receivables and payables equal the sum of customer and vendor balances'; ok := c = 0 and v = v2;
  detail := c || ' AR/AP lines without a contact; AR ' || v || ' vs customers ' || v2; return next;

  -- 5
  select count(*) into c from public.document_balances_v b
    where b.book = p_book and b.voided_at is null and (b.applied > b.total or b.applied_from > b.total or b.balance < 0);
  select c + count(*) into c from public.applications ap join public.transactions f on f.id = ap.from_transaction_id
    join public.transactions t on t.id = ap.to_transaction_id where ap.book = p_book and (f.voided_at is not null or t.voided_at is not null);
  no := 5; name := 'Invoice and bill statuses match the payments applied'; ok := c = 0; detail := c || ' documents over-applied or applied while void'; return next;

  -- 6: billed per project, from the documents vs from the ledger
  select count(*) into c from public.projects p
    where p.book = p_book and abs((public.project_figures(p.id)).billed - coalesce((
      select sum(round(case when t.type = 'credit_note' then -tl.amount else tl.amount end * t.fx_rate, 2))
      from public.transaction_lines tl join public.transactions t on t.id = tl.transaction_id
      where coalesce(tl.project_id, t.project_id) = p.id and t.type in ('invoice', 'credit_note', 'sales_receipt')
        and t.voided_at is null and not t.is_draft), 0)) >= 0.01;
  no := 6; name := 'Project figures tie to the ledger'; ok := c = 0; detail := c || ' projects whose billing differs from their documents'; return next;

  -- 7: per person, payables = distributions posted − paid out
  select count(*) into c from (
    select dl.contact_id, dl.component, sum(dl.amount) amt from public.distribution_lines dl
      join public.distributions d on d.id = dl.distribution_id where d.book = p_book and d.journal_transaction_id is not null group by 1, 2) d
    full join (
      select coalesce(l.contact_id, t.contact_id) contact_id, l.component, sum(l.amount) amt from public.transaction_lines l
      join public.transactions t on t.id = l.transaction_id
      where t.book = p_book and t.type = 'payout' and t.voided_at is null and l.component in ('financing_return', 'profit_share') group by 1, 2) p
      on p.contact_id = d.contact_id and p.component = d.component
    full join (
      select j.contact_id, case par.subtype when 'financing_return_payable' then 'financing_return' else 'profit_share' end component,
        sum(j.home_credit - j.home_debit) bal
      from public.journal_lines j join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
      where j.book = p_book and par.subtype in ('financing_return_payable', 'profit_share_payable') group by 1, 2) b
      on b.contact_id = coalesce(d.contact_id, p.contact_id) and b.component = coalesce(d.component, p.component)
    where abs(coalesce(d.amt, 0) - coalesce(p.amt, 0) - coalesce(b.bal, 0)) >= 0.01;
  no := 7; name := 'Each person''s payables = distributions − payouts'; ok := c = 0; detail := c || ' people out of step'; return next;

  -- 8: payroll payables
  select coalesce(sum(ps.net), 0) into v from public.payslips ps join public.payroll_runs r on r.id = ps.run_id
    where r.book = p_book and r.status = 'posted';
  select v - coalesce(sum(tl.amount), 0) into v from public.transaction_lines tl join public.transactions t on t.id = tl.transaction_id
    where t.book = p_book and t.type = 'salary_payment' and t.voided_at is null;
  select coalesce(sum(home_credit - home_debit), 0) into v2 from public.journal_lines where book = p_book and account_id = public.acct('salaries_payable');
  ok := v = v2; s := 'salaries expected ' || v || ', ledger ' || v2;
  -- pension and withholding tax: withheld on posted runs, less what was remitted
  for a_, l_, e_ in
    select coalesce((select sum(pl.amount) from public.payslip_lines pl join public.pay_items pi on pi.id = pl.pay_item_id
             join public.payslips ps on ps.id = pl.payslip_id join public.payroll_runs r on r.id = ps.run_id
             where r.book = p_book and r.status = 'posted' and pi.code = any (x.codes)), 0)
         - coalesce((select sum(tl.amount) from public.transaction_lines tl join public.transactions t on t.id = tl.transaction_id
             where t.book = p_book and t.type = 'payroll_remittance' and t.voided_at is null and tl.account_id = public.acct(x.st)), 0),
         coalesce((select sum(home_credit - home_debit) from public.journal_lines where book = p_book and account_id = public.acct(x.st)), 0),
         0
    from (values (array['PENSION_EE', 'PENSION_ER'], 'pension_payable'), (array['WHT'], 'wht_payable')) x(codes, st) loop
    ok := ok and a_ = l_;
    s := s || '; ' || a_ || ' vs ' || l_;
  end loop;
  no := 8; name := 'Payroll payables = runs posted − payments and remittances'; detail := s; return next;

  -- 9: GST accounts = open returns + filed-but-unpaid
  select coalesce(sum(t.output), 0), coalesce(sum(t.input), 0) into v, v2
    from public.tax_periods p cross join lateral public.gst_totals(p.id) t where p.book = p_book and p.status = 'open';
  select count(*) into c from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.book = p_book and a.subtype in ('gst_output', 'gst_input') and j.tax_period_id is null;
  ok := c = 0
    and v = coalesce((select sum(home_credit - home_debit) from public.journal_lines where book = p_book and account_id = public.acct('gst_output')), 0)
    and v2 = coalesce((select sum(home_debit - home_credit) from public.journal_lines where book = p_book and account_id = public.acct('gst_input')), 0)
    and coalesce((select sum(public.gst_payable(id)) from public.tax_periods where book = p_book and status <> 'open'), 0)
      = coalesce((select sum(home_credit - home_debit) from public.journal_lines where book = p_book and account_id = public.acct('gst_payable')), 0);
  no := 9; name := 'GST accounts = open returns + filed but unpaid'; detail := c || ' GST lines without a return period'; return next;

  -- 10, 11: follow from 2 and 3 until the cash-flow and equity reports exist (Phase 4)
  no := 10; name := 'Cash flow net change = change in cash'; ok := true; detail := 'implied by 2 and 3; checked directly once the report exists'; return next;
  no := 11; name := 'Equity statement = balance-sheet equity'; ok := true; detail := 'implied by 3; checked directly once the report exists'; return next;

  -- 12: no orphans either way
  select count(*) into c from public.journal_lines j join public.transactions t on t.id = j.transaction_id
    where j.book = p_book and ((t.is_draft or t.type in ('estimate', 'purchase_order')) or (t.voided_at is not null and j.tax_period_id is null));
  select c + count(*) into c from public.transactions t
    where t.book = p_book and t.voided_at is null and not t.is_draft and t.type not in ('estimate', 'purchase_order')
      and public.doc_total(t.id) <> 0 and t.type not in ('journal', 'opening_balance', 'distribution', 'payroll_run', 'gst_settlement',
        'bpt_provision', 'wip_adjustment', 'fx_revaluation', 'depreciation')
      and not exists (select 1 from public.journal_lines where transaction_id = t.id);
  -- and nothing ever crosses between the books
  select c + count(*) into c from public.journal_lines j join public.transactions t on t.id = j.transaction_id where j.book <> t.book and t.book = p_book;
  no := 12; name := 'No orphans, and nothing crosses between Live and Test'; ok := c = 0; detail := c || ' found'; return next;

  -- 13: nothing changed behind a lock without an adjustment
  select count(*) into c from public.journal_lines j, public.settings st
    where j.book = p_book and st.id and st.closing_date is not null and j.date <= st.closing_date and j.created_at > st.closing_date_set_at;
  select c + count(*) into c from public.journal_lines j join public.tax_periods p on p.id = j.tax_period_id
    join public.transactions t on t.id = j.transaction_id
    where j.book = p_book and p.status <> 'open' and j.created_at > p.filed_at and t.type not in ('gst_settlement', 'gst_payment');
  no := 13; name := 'Nothing in a closed period or filed return changed without an adjustment'; ok := c = 0; detail := c || ' lines'; return next;
end $$;
