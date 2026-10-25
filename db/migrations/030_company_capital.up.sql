-- 030 · Financing a project from company capital: the company's own money and
-- what each director has earned but left in the company (released profit
-- shares not yet paid out). Each one's part of a financing is in proportion
-- to what they have available, and counts toward the financing pool's share
-- of profit by amount, the company's included (its share stays as profit).
--
-- A director's part is posted as what it is: their profit share paid out and
-- put straight back in as their Capital Pool money for this project (a payout
-- and a capital contribution through the same account, so the bank nets to
-- nothing and every payable rule and Health Check still holds). The company's
-- own part moves no money between parties; it is recorded here.

create table public.project_company_funding (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects,
  date date not null,
  amount numeric(18,2) not null check (amount > 0),
  book text not null default public.current_book() check (book in ('live', 'sandbox')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index project_company_funding_project on public.project_company_funding (project_id);
alter table public.project_company_funding enable row level security;
create policy project_company_funding_read on public.project_company_funding for select to authenticated
  using (public.is_staff() and book = public.current_book());
revoke all on public.project_company_funding from anon;
grant select on public.project_company_funding to authenticated;

/**
 * What can finance a project from company capital, in the current book: each
 * director's released profit share (their project is completed and its client
 * has paid in full, so it could be paid out today), and the company's own
 * money — bank and cash, less what those directors are owed.
 */
create or replace function public.company_capital_available()
returns table (contact_id uuid, name text, available numeric) language sql stable set search_path = public, pg_temp as $$
  with directors as (
    select j.contact_id, c.name, sum(j.home_credit - j.home_debit) available
    from public.journal_lines j
    join public.accounts a on a.id = j.account_id
    join public.accounts par on par.id = a.parent_id
    join public.contacts c on c.id = j.contact_id
    join public.projects p on p.id = j.project_id
    where j.book = public.current_book() and par.subtype = 'profit_share_payable' and 'partner' = any (c.kinds)
      and p.completed_at is not null and abs(public.client_balance(p.id)) < 0.005
    group by j.contact_id, c.name
    having sum(j.home_credit - j.home_debit) > 0
  ), money as (
    select coalesce(sum(j.home_debit - j.home_credit), 0) total
    from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.book = public.current_book() and a.subtype in ('bank', 'cash')
  )
  select x.contact_id, x.name, x.available from (
    select d.contact_id, d.name, d.available, 0 k from directors d
    union all
    select null::uuid, 'Company', greatest(m.total - coalesce((select sum(available) from directors), 0), 0), 1 from money m
  ) x order by x.k, x.available desc, x.name
$$;

/** The company's own financing of a project, in the current book. */
create or replace function public.company_funding(p_project uuid) returns numeric language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0) from public.project_company_funding where project_id = p_project and book = public.current_book()
$$;

/**
 * Finance a project from company capital (admin only): p_amount is split
 * among the directors and the company by what each has available, and posted
 * on p_date through the money account p_bank.
 */
create or replace function public.rpc_finance_from_company_capital(p_project uuid, p_date date, p_amount numeric, p_bank uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.projects; total numeric; amount_l bigint; given_l bigint := 0; share_l bigint; left_l bigint; take numeric;
  d record; r record; lines jsonb; v_payout uuid; v_contrib uuid; result jsonb := '[]'::jsonb;
begin
  perform public.require_role('admin');
  select * into p from public.projects where id = p_project for update;
  perform public._require_book(p.book);
  if p.completed_at is not null then raise exception 'This project is completed; it takes no more financing'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount to finance'; end if;
  if p_date is null then raise exception 'Enter the date'; end if;
  if not exists (select 1 from public.accounts where id = p_bank and subtype in ('bank', 'cash')) then
    raise exception 'Choose the bank or cash account it goes through';
  end if;
  create temp table if not exists _cc_take (contact_id uuid, name text, available numeric) on commit drop;
  truncate _cc_take;
  insert into _cc_take select x.contact_id, x.name, x.available from public.company_capital_available() x;
  select coalesce(sum(available), 0) into total from _cc_take;
  if p_amount > total then
    raise exception 'Company capital available is MVR %; that is the most this can be', to_char(total, 'FM999,999,999,990.00');
  end if;
  amount_l := round(p_amount * 100)::bigint;

  -- each director's part, by what they have available; the company takes the rest (and every rounding laari)
  for d in select * from _cc_take where contact_id is not null and available > 0 order by available desc, name loop
    share_l := floor(amount_l * d.available / total)::bigint;
    if share_l <= 0 then continue; end if;
    given_l := given_l + share_l;
    -- paid out of their released profit shares, project by project, oldest completion first
    lines := '[]'::jsonb; left_l := share_l;
    for r in select j.project_id, sum(j.home_credit - j.home_debit) owed, min(pr.completed_at) done
             from public.journal_lines j join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
             join public.projects pr on pr.id = j.project_id
             where j.book = public.current_book() and par.subtype = 'profit_share_payable' and j.contact_id = d.contact_id
               and pr.completed_at is not null and abs(public.client_balance(pr.id)) < 0.005
             group by j.project_id having sum(j.home_credit - j.home_debit) > 0 order by min(pr.completed_at), j.project_id loop
      exit when left_l <= 0;
      take := least(round(r.owed * 100)::bigint, left_l) / 100.0;
      lines := lines || jsonb_build_object('project_id', r.project_id, 'component', 'profit_share', 'amount', take, 'contact_id', d.contact_id);
      left_l := left_l - round(take * 100)::bigint;
    end loop;
    v_payout := public.rpc_save_transaction(jsonb_build_object('type', 'payout', 'is_draft', true, 'date', p_date,
      'contact_id', d.contact_id, 'bank_account_id', p_bank, 'total_amount', share_l / 100.0,
      'reference', 'Reinvested in ' || p.code, 'memo', 'Profit share left in the company, put into ' || p.code || ' as company capital',
      'lines', lines));
    perform public._approve_payout(v_payout);
    v_contrib := public.rpc_save_transaction(jsonb_build_object('type', 'capital_contribution', 'date', p_date,
      'contact_id', d.contact_id, 'project_id', p_project, 'bank_account_id', p_bank, 'total_amount', share_l / 100.0,
      'reference', 'Company capital', 'memo', 'From profit share left in the company'));
    result := result || jsonb_build_object('contact_id', d.contact_id, 'name', d.name, 'amount', share_l / 100.0);
  end loop;

  if amount_l - given_l > 0 then
    insert into public.project_company_funding (project_id, date, amount, book) values (p_project, p_date, (amount_l - given_l) / 100.0, p.book);
    result := result || jsonb_build_object('contact_id', null, 'name', 'Company', 'amount', (amount_l - given_l) / 100.0);
  end if;
  return result;
end $$;

/** As in 009, with the company's own financing counted in the total that divides the financing pool's share (030). */
create or replace function public.split_profit(p_project uuid, p_profit numeric)
returns table (contact_id uuid, party_type text, component text, amount numeric) language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_scheme uuid; profit_l bigint; pool_pct numeric; pool_l bigint; fin_total numeric; s record;
begin
  if coalesce(p_profit, 0) <= 0 then return; end if;
  select coalesce(p.scheme_id, public.scheme_on(coalesce(p.start_date, current_date))) into v_scheme from public.projects p where p.id = p_project;
  profit_l := round(p_profit * 100)::bigint;
  select coalesce(sum(sa.percent), 0) into pool_pct from public.scheme_allocations sa where sa.scheme_id = v_scheme and sa.party_type = 'financing_pool';
  pool_l := floor(profit_l * pool_pct / 100)::bigint;
  select coalesce(sum(f.received), 0) into fin_total from public.project_financing_v f where f.project_id = p_project;
  -- the company's own part shares by amount too; its return is not posted, so it stays as profit
  fin_total := fin_total + coalesce((select sum(cf.amount) from public.project_company_funding cf where cf.project_id = p_project), 0);
  if fin_total > 0 and pool_l > 0 then
    for s in select f.contact_id cid, f.received from public.project_financing_v f join public.contacts c on c.id = f.contact_id
             where f.project_id = p_project and f.received > 0 order by f.received desc, c.name loop
      contact_id := s.cid; party_type := 'financing_pool'; component := 'financing_return';
      amount := floor(pool_l * s.received / fin_total)::bigint / 100.0;
      if amount > 0 then return next; end if;
    end loop;
  end if;
  for s in select sa.contact_id cid, sa.percent from public.scheme_allocations sa where sa.scheme_id = v_scheme and sa.party_type = 'person' order by sa.sort_order loop
    contact_id := s.cid; party_type := 'person'; component := 'profit_share';
    amount := floor(profit_l * s.percent / 100)::bigint / 100.0;
    if amount > 0 then return next; end if;
  end loop;
end $$;

revoke execute on function public.company_capital_available() from public, anon;
revoke execute on function public.company_funding(uuid) from public, anon;
revoke execute on function public.rpc_finance_from_company_capital(uuid, date, numeric, uuid) from public, anon;
grant execute on function public.company_capital_available() to authenticated;
grant execute on function public.company_funding(uuid) to authenticated;
grant execute on function public.rpc_finance_from_company_capital(uuid, date, numeric, uuid) to authenticated;
