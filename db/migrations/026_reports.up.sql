-- 026 · Reports and financial statements (§11).
-- Every statement is worked out from journal lines, in the current book:
-- • report_tb: each account's opening, debits, credits and closing for a range;
-- • report_by: profit-and-loss lines by project, contact or employee;
-- • cash_flow: indirect method, every non-cash account's movement in a
--   section, so the sections always add up to the change in cash;
-- • cash_summary: direct method, cash in and out by kind of transaction;
-- • equity_changes: share capital, retained earnings and other equity.
-- Health checks 10 and 11 now test the cash-flow and equity statements
-- themselves. Saved reports keep a name and a report's filters per user.

/** The first day of the financial year a date falls in (settings.fiscal_year_start_month). */
create or replace function public.fiscal_year_start(p_date date) returns date language sql stable set search_path = public, pg_temp as $$
  select make_date(extract(year from p_date)::int - case when extract(month from p_date)::int < s.m then 1 else 0 end, s.m, 1)
  from (select coalesce((select fiscal_year_start_month from public.settings where id), 1) m) s
$$;

/** An account's subtype, or its parent's for a per-person sub-account. */
create or replace function public._subtype(p_account uuid) returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce(a.subtype, par.subtype) from public.accounts a left join public.accounts par on par.id = a.parent_id where a.id = p_account
$$;

/**
 * Trial balance for a range: opening (before p_from), debits and credits in
 * the range, closing (to p_to). Debit balances are positive. Optionally for one
 * project or one contact.
 */
create or replace function public.report_tb(p_from date, p_to date, p_project uuid default null, p_contact uuid default null,
  p_book text default public.current_book())
returns table (account_id uuid, code text, name text, type public.account_type, subtype text, parent_id uuid,
  opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable set search_path = public, pg_temp as $$
  select a.id, a.code, a.name, a.type, coalesce(a.subtype, par.subtype), a.parent_id,
    coalesce(sum(j.home_debit - j.home_credit) filter (where j.date < p_from), 0),
    coalesce(sum(j.home_debit) filter (where j.date >= p_from), 0),
    coalesce(sum(j.home_credit) filter (where j.date >= p_from), 0),
    coalesce(sum(j.home_debit - j.home_credit), 0)
  from public.journal_lines j
  join public.accounts a on a.id = j.account_id
  left join public.accounts par on par.id = a.parent_id
  where j.book = p_book and j.date <= p_to
    and (p_project is null or j.project_id = p_project) and (p_contact is null or j.contact_id = p_contact)
  group by a.id, a.code, a.name, a.type, a.subtype, par.subtype, a.parent_id
$$;

/** Income and expense lines in a range by project, contact or employee (credit positive). */
create or replace function public.report_by(p_from date, p_to date, p_dim text, p_book text default public.current_book())
returns table (dim_id uuid, account_id uuid, amount numeric) language sql stable set search_path = public, pg_temp as $$
  select case p_dim when 'project' then j.project_id when 'contact' then j.contact_id when 'employee' then j.employee_id end,
    j.account_id, sum(j.home_credit - j.home_debit)
  from public.journal_lines j join public.accounts a on a.id = j.account_id
  where j.book = p_book and j.date between p_from and p_to and a.type in ('income', 'cogs', 'expense')
  group by 1, 2
$$;

/** Where an account's movement goes in the cash-flow statement. */
create or replace function public._cf_section(p_type public.account_type, p_subtype text) returns text language sql immutable as $$
  select case
    when p_subtype in ('bank', 'cash', 'undeposited') then 'cash'
    when p_type in ('income', 'cogs', 'expense') then 'profit'
    when p_subtype = 'accumulated_depreciation' then 'operating'
    when p_subtype = 'fixed_asset' then 'investing'
    when p_subtype in ('project_loans', 'capital_pool_loans', 'financing_return_payable', 'profit_share_payable') or p_type = 'equity' then 'financing'
    else 'operating' end
$$;

/**
 * Statement of cash flows, indirect method. Inflows are positive. Opening
 * balances entered in the range are shown on their own line, so
 * cash_start + operating + investing + financing + opening_balances = cash_end.
 */
create or replace function public.cash_flow(p_from date, p_to date, p_book text default public.current_book())
returns table (section text, sort int, label text, amount numeric) language sql stable set search_path = public, pg_temp as $$
  with l as (
    select j.home_debit, j.home_credit, j.date, t.type = 'opening_balance' as ob,
      public._cf_section(a.type, coalesce(a.subtype, par.subtype)) sec, coalesce(a.subtype, par.subtype) st,
      coalesce(par.name, a.name) acct_name, coalesce(par.code, a.code) acct_code
    from public.journal_lines j
    join public.transactions t on t.id = j.transaction_id
    join public.accounts a on a.id = j.account_id
    left join public.accounts par on par.id = a.parent_id
    where j.book = p_book and j.date <= p_to
  ), mv as (select * from l where date >= p_from and not ob)
  select 'cash_start', 0, 'Cash at the start of the period', coalesce(sum(home_debit - home_credit), 0) from l where sec = 'cash' and date < p_from
  union all
  select 'operating', 1, 'Profit for the period', coalesce(sum(home_credit - home_debit), 0) from mv where sec = 'profit'
  union all
  select sec, case when st = 'accumulated_depreciation' then 2 else 3 end,
    case when st = 'accumulated_depreciation' then 'Depreciation'
      when sec = 'operating' then 'Change in ' || acct_name else acct_name end,
    sum(home_credit - home_debit)
  from mv where sec in ('operating', 'investing', 'financing')
  group by sec, st = 'accumulated_depreciation', acct_code, acct_name
  having sum(home_credit - home_debit) <> 0
  union all
  select 'opening_balances', 9, 'Opening balances entered', sum(home_debit - home_credit)
  from l where ob and date >= p_from and sec = 'cash' having sum(home_debit - home_credit) <> 0
  union all
  select 'cash_end', 10, 'Cash at the end of the period', coalesce(sum(home_debit - home_credit), 0) from l where sec = 'cash'
$$;

/** Direct cash summary: each transaction's net effect on cash, in and out by kind (transfers between cash accounts net to nothing). */
create or replace function public.cash_summary(p_from date, p_to date, p_book text default public.current_book())
returns table (kind text, cash_in numeric, cash_out numeric) language sql stable set search_path = public, pg_temp as $$
  with n as (
    select t.type::text kind, sum(j.home_debit - j.home_credit) net
    from public.journal_lines j join public.transactions t on t.id = j.transaction_id
    where j.book = p_book and j.date between p_from and p_to and public._subtype(j.account_id) in ('bank', 'cash', 'undeposited')
    group by t.id, t.type
    having sum(j.home_debit - j.home_credit) <> 0
  )
  select kind, coalesce(sum(net) filter (where net > 0), 0), coalesce(-sum(net) filter (where net < 0), 0) from n group by kind
$$;

/**
 * Statement of changes in equity (credit positive): opening, profit, dividends,
 * share capital issued, other movements, closing — by component.
 */
create or replace function public.equity_changes(p_from date, p_to date, p_book text default public.current_book())
returns table (sort int, label text, share_capital numeric, retained_earnings numeric, other_equity numeric, total numeric)
language sql stable set search_path = public, pg_temp as $$
  with l as (
    select j.date, j.home_credit - j.home_debit amt, a.type, coalesce(a.subtype, par.subtype) st
    from public.journal_lines j join public.accounts a on a.id = j.account_id left join public.accounts par on par.id = a.parent_id
    where j.book = p_book and j.date <= p_to and a.type in ('equity', 'income', 'cogs', 'expense')
  ), c as (
    select date,
      case when st = 'share_capital' then 'sc'
        when type <> 'equity' then 'pl'
        when st = 'dividends' then 'div'
        when st = 'retained_earnings' then 're'
        else 'other' end k, amt
    from l
  ), r as (
    select 0 s, 'Balance at the start' lbl,
      coalesce(sum(amt) filter (where k = 'sc'), 0) sc, coalesce(sum(amt) filter (where k in ('pl', 'div', 're')), 0) re, coalesce(sum(amt) filter (where k = 'other'), 0) ot
    from c where date < p_from
    union all select 1, 'Profit for the period', 0, coalesce(sum(amt), 0), 0 from c where date >= p_from and k = 'pl'
    union all select 2, 'Dividends', 0, coalesce(sum(amt), 0), 0 from c where date >= p_from and k = 'div'
    union all select 3, 'Share capital issued', coalesce(sum(amt), 0), 0, 0 from c where date >= p_from and k = 'sc'
    union all select 4, 'Other movements', 0, coalesce(sum(amt) filter (where k = 're'), 0), coalesce(sum(amt) filter (where k = 'other'), 0) from c where date >= p_from
  )
  select s, lbl, sc, re, ot, sc + re + ot from r
  union all
  select 9, 'Balance at the end', sum(sc), sum(re), sum(ot), sum(sc + re + ot) from r
$$;

-- ── health checks 10 and 11, now against the statements themselves ──────
alter function public.health_check(text) rename to _health_check_base;

create or replace function public.health_check(p_book text default public.current_book())
returns table (no int, name text, ok boolean, detail text) language plpgsql stable set search_path = public, pg_temp as $$
declare f date := public.fiscal_year_start(public.today_mv()); t date; flows numeric; start_cash numeric; cash numeric; eq numeric; net_assets numeric;
begin
  t := greatest(public.today_mv(), f);
  -- 10: the statement's sections add up to the change in cash (read from the cash accounts themselves), this year to date
  select coalesce(sum(cf.amount) filter (where cf.section in ('operating', 'investing', 'financing', 'opening_balances')), 0),
         coalesce(sum(cf.amount) filter (where cf.section = 'cash_start'), 0)
    into flows, start_cash from public.cash_flow(f, t, p_book) cf;
  select coalesce(sum(j.home_debit - j.home_credit), 0) into cash from public.journal_lines j
    where j.book = p_book and j.date <= t and public._subtype(j.account_id) in ('bank', 'cash', 'undeposited');
  -- 11: the equity statement's closing total = assets − liabilities
  select ec.total into eq from public.equity_changes(f, t, p_book) ec where ec.sort = 9;
  select coalesce(sum(j.home_debit - j.home_credit), 0) into net_assets
    from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.book = p_book and j.date <= t and a.type in ('asset', 'liability');
  return query
    select h.no, h.name, h.ok, h.detail from public._health_check_base(p_book) h where h.no not in (10, 11)
    union all
    select 10, 'Cash flow net change = change in cash', start_cash + flows = cash, format('start %s + flows %s vs cash %s', start_cash, flows, cash)
    union all
    select 11, 'Equity statement = balance-sheet equity', coalesce(eq, 0) = net_assets, format('equity statement %s vs net assets %s', coalesce(eq, 0), net_assets)
    order by 1;
end $$;

-- ── saved reports ────────────────────────────────────────────────────────
create table public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null check (length(trim(name)) > 0),
  report text not null,
  params jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.saved_reports enable row level security;
create policy saved_reports_own on public.saved_reports for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_staff());
revoke all on public.saved_reports from anon;


do $$
declare f text;
begin
  foreach f in array array['fiscal_year_start(date)', '_subtype(uuid)', 'report_tb(date, date, uuid, uuid, text)', 'report_by(date, date, text, text)',
    '_cf_section(public.account_type, text)', 'cash_flow(date, date, text)', 'cash_summary(date, date, text)', 'equity_changes(date, date, text)'] loop
    execute 'revoke execute on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
