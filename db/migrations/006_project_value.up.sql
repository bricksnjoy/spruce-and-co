-- 006 · Projects and project value (§4). Every figure is derived from the
-- ledger and the project's own contract, variations and budget; no totals are stored.

alter table public.projects
  add column if not exists customer_id uuid references public.contacts,
  add column if not exists scheme_id uuid,
  add column if not exists recognition_method text check (recognition_method in ('billing', 'poc')),
  add column if not exists review_flag text;
update public.projects p set customer_id = c.id
  from public.contacts c where c.legacy ->> 'client_id' = p.client_id::text and p.customer_id is null;

-- variations: numbered per project, with the amount the contract moves by
alter table public.variations
  add column if not exists number int,
  add column if not exists amount numeric(18,2);
update public.variations v set number = x.n, amount = coalesce(v.amount, v.cost_impact)
  from (select id, row_number() over (partition by project_id order by raised_date, created_at) n from public.variations) x
  where x.id = v.id;
create unique index if not exists variations_number on public.variations (project_id, number);

create or replace function public.number_variation() returns trigger language plpgsql as $$
begin
  if new.number is null then
    select coalesce(max(number), 0) + 1 into new.number from public.variations where project_id = new.project_id;
  end if;
  if new.amount is null then new.amount := new.cost_impact; end if;
  return new;
end $$;
create trigger variations_number before insert on public.variations for each row execute function public.number_variation();

-- budget by job-cost category, with a revised budget and an editable forecast to complete
alter table public.budget_lines
  add column if not exists budget_category text check (budget_category in ('materials', 'subcontractors', 'labour', 'equipment', 'freight', 'site', 'other')),
  add column if not exists revised_amount numeric(18,2),
  add column if not exists forecast_to_complete numeric(18,2) check (forecast_to_complete >= 0);

-- progress billing: stages that become invoices
create table public.billing_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  sort_order int not null default 0,
  name text not null,
  basis text not null default 'percent' check (basis in ('percent', 'amount')),
  value numeric(18,4) not null check (value > 0),
  due_event text,
  invoice_id uuid references public.transactions,
  created_at timestamptz not null default now()
);

/** What the client still owes on a project: receivables and retention tagged to it. */
create or replace function public.client_balance(p_project uuid, p_as_of date default null) returns numeric language sql stable as $$
  select coalesce(sum(j.home_debit - j.home_credit), 0)
  from public.journal_lines j join public.accounts a on a.id = j.account_id
  where j.project_id = p_project and a.subtype in ('ar', 'retention_receivable') and (p_as_of is null or j.date <= p_as_of)
$$;

/**
 * A project's actual profit from the ledger (decision P1): revenue less direct
 * job costs (including site labour and non-claimable GST) and bad debts written
 * off on it (§6). WIP adjustments and profit distributions are not profit.
 */
create or replace function public.project_profit(p_project uuid, p_as_of date default null) returns numeric language sql stable as $$
  select coalesce(sum(case when a.type = 'income' then j.home_credit - j.home_debit else j.home_credit - j.home_debit end), 0)
  from public.journal_lines j
  join public.accounts a on a.id = j.account_id
  join public.transactions t on t.id = j.transaction_id
  where j.project_id = p_project
    and (a.type in ('income', 'cogs') or a.subtype = 'bad_debts')
    and t.type not in ('wip_adjustment', 'distribution')
    and (p_as_of is null or j.date <= p_as_of)
$$;

create type public.project_figures_t as (
  original numeric, variations numeric, revised numeric,
  billed numeric, billed_pct numeric, remaining_to_bill numeric, collected numeric, client_balance numeric, retention_held numeric,
  cost_to_date numeric, budget numeric, revised_budget numeric, forecast_to_complete numeric, forecast_final_cost numeric,
  forecast_profit numeric, margin_pct numeric, pct_complete numeric, earned numeric, over_under_billing numeric,
  actual_profit numeric, bad_debts numeric, costs jsonb
);

/** Everything the Project Value screen shows, for any date. */
create or replace function public.project_figures(p_project uuid, p_as_of date default null)
returns public.project_figures_t language plpgsql stable as $$
declare
  f public.project_figures_t; p public.projects;
begin
  select * into p from public.projects where id = p_project;
  if not found then raise exception 'No such project'; end if;
  f.original := p.contract_value;
  select coalesce(sum(amount), 0) into f.variations from public.variations
    where project_id = p_project and status = 'approved' and (p_as_of is null or coalesce(approved_date, raised_date) <= p_as_of);
  f.revised := f.original + f.variations;

  select coalesce(sum(j.home_credit - j.home_debit), 0) into f.billed
    from public.journal_lines j join public.accounts a on a.id = j.account_id join public.transactions t on t.id = j.transaction_id
    where j.project_id = p_project and a.type = 'income' and t.type in ('invoice', 'credit_note', 'sales_receipt')
      and (p_as_of is null or j.date <= p_as_of);
  f.billed_pct := case when f.revised > 0 then round(f.billed / f.revised * 100, 2) else 0 end;
  f.remaining_to_bill := f.revised - f.billed;
  select coalesce(sum(j.home_credit - j.home_debit), 0) into f.collected
    from public.journal_lines j join public.accounts a on a.id = j.account_id join public.transactions t on t.id = j.transaction_id
    where j.project_id = p_project and a.subtype = 'ar' and t.type in ('customer_payment', 'advance_application')
      and (p_as_of is null or j.date <= p_as_of);
  f.client_balance := public.client_balance(p_project, p_as_of);
  select coalesce(sum(j.home_debit - j.home_credit), 0) into f.retention_held
    from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.project_id = p_project and a.subtype = 'retention_receivable' and (p_as_of is null or j.date <= p_as_of);
  select coalesce(sum(j.home_debit - j.home_credit), 0) into f.bad_debts
    from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.project_id = p_project and a.subtype = 'bad_debts' and (p_as_of is null or j.date <= p_as_of);

  -- cost and budget by category
  with actual as (
    select coalesce(a.budget_category, 'other') cat, sum(j.home_debit - j.home_credit) amt
    from public.journal_lines j join public.accounts a on a.id = j.account_id join public.transactions t on t.id = j.transaction_id
    where j.project_id = p_project and a.type = 'cogs' and t.type <> 'wip_adjustment' and (p_as_of is null or j.date <= p_as_of)
    group by 1),
  budget as (
    select coalesce(budget_category, 'other') cat, sum(budget_amount) budget, sum(coalesce(revised_amount, budget_amount)) revised,
      sum(forecast_to_complete) ftc, bool_and(forecast_to_complete is null) no_ftc
    from public.budget_lines where project_id = p_project group by 1),
  cats as (
    select coalesce(a.cat, b.cat) cat, coalesce(a.amt, 0) actual, coalesce(b.budget, 0) budget, coalesce(b.revised, 0) revised,
      case when b.no_ftc is false then b.ftc else greatest(coalesce(b.revised, 0) - coalesce(a.amt, 0), 0) end ftc
    from actual a full join budget b on a.cat = b.cat)
  select coalesce(sum(actual), 0), coalesce(sum(budget), 0), coalesce(sum(revised), 0), coalesce(sum(ftc), 0),
    coalesce(jsonb_agg(jsonb_build_object('category', cat, 'actual', actual, 'budget', budget, 'revised', revised, 'forecast_to_complete', ftc)
      order by cat), '[]')
  into f.cost_to_date, f.budget, f.revised_budget, f.forecast_to_complete, f.costs from cats;

  -- a finished project has nothing left to spend
  if p.completed_at is not null and (p_as_of is null or p.completed_at::date <= p_as_of) then f.forecast_to_complete := 0; end if;
  f.forecast_final_cost := f.cost_to_date + f.forecast_to_complete;
  f.forecast_profit := f.revised - f.forecast_final_cost;
  f.margin_pct := case when f.revised > 0 then round(f.forecast_profit / f.revised * 100, 2) else 0 end;
  -- percentage of completion, cost to cost
  f.pct_complete := case when f.forecast_final_cost > 0 then least(round(f.cost_to_date / f.forecast_final_cost * 100, 4), 100) else 0 end;
  -- from the exact ratio, not the rounded percentage
  f.earned := case when f.forecast_final_cost > 0 then round(f.revised * least(f.cost_to_date / f.forecast_final_cost, 1), 2) else 0 end;
  f.over_under_billing := f.billed - f.earned;   -- positive: billed ahead of the work
  f.actual_profit := public.project_profit(p_project, p_as_of);
  return f;
end $$;

create or replace view public.project_value_v as
select p.id, p.code, p.name, p.customer_id, p.status, p.completed_at, f.*
from public.projects p cross join lateral public.project_figures(p.id) f;

/** Active → Completed → Settled → Closed, derived (§6). */
create or replace function public.project_stage(p_project uuid) returns text language sql stable as $$
  select case
    when p.completed_at is null then 'active'
    when abs(public.client_balance(p.id)) >= 0.005 then 'completed'
    when exists (
      select 1 from public.journal_lines j join public.accounts a on a.id = j.account_id
      join public.accounts par on par.id = a.parent_id
      where j.project_id = p.id and par.subtype in ('project_loans', 'capital_pool_loans', 'financing_return_payable', 'profit_share_payable')
      group by j.account_id having abs(sum(j.home_debit - j.home_credit)) >= 0.005) then 'settled'
    else 'closed' end
  from public.projects p where p.id = p_project
$$;

/**
 * Percentage-of-completion WIP at a period end (§4): earned beyond billed goes
 * to Contract Asset, billed beyond earned to Contract Liability. Each entry is
 * reversed on the first day of the next period.
 */
create or replace function public.run_wip(p_period_end date) returns int language plpgsql as $$
declare p record; f public.project_figures_t; d numeric; v_id uuid; v_rev uuid; n int := 0; dr uuid; cr uuid;
begin
  for p in select pr.id, pr.code from public.projects pr
           where coalesce(pr.recognition_method, (select recognition_default from public.settings where id)) = 'poc'
             and (pr.completed_at is null or pr.completed_at::date > p_period_end)
             and not exists (select 1 from public.transactions t where t.type = 'wip_adjustment' and t.project_id = pr.id
                             and t.date = p_period_end and t.reverses_id is null and t.voided_at is null) loop
    f := public.project_figures(p.id, p_period_end);
    d := f.earned - f.billed;
    continue when d = 0;
    if d > 0 then dr := public.acct('contract_asset'); cr := public.acct('contract_revenue');
    else dr := public.acct('contract_revenue'); cr := public.acct('contract_liability'); end if;
    insert into public.transactions (type, date, project_id, memo) values ('wip_adjustment', p_period_end, p.id, 'WIP ' || p.code)
      returning id into v_id;
    insert into public.transaction_lines (transaction_id, line_no, account_id, debit, project_id) values (v_id, 1, dr, abs(d), p.id);
    insert into public.transaction_lines (transaction_id, line_no, account_id, credit, project_id) values (v_id, 2, cr, abs(d), p.id);
    perform public.post_transaction(v_id);
    insert into public.transactions (type, date, project_id, memo, reverses_id)
      values ('wip_adjustment', p_period_end + 1, p.id, 'Reversal of WIP ' || p.code, v_id) returning id into v_rev;
    insert into public.transaction_lines (transaction_id, line_no, account_id, credit, project_id) values (v_rev, 1, dr, abs(d), p.id);
    insert into public.transaction_lines (transaction_id, line_no, account_id, debit, project_id) values (v_rev, 2, cr, abs(d), p.id);
    perform public.post_transaction(v_rev);
    n := n + 1;
  end loop;
  return n;
end $$;

create trigger billing_stages_audit after insert or update or delete on public.billing_stages for each row execute function public.log_change();
create trigger budget_lines_audit after insert or update or delete on public.budget_lines for each row execute function public.log_change();
