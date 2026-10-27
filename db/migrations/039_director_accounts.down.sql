-- Directors' accounts keep their entries; the 2750 account is made inactive (a system account is never deleted).
drop function if exists public.rpc_finance_from_capital_pool(uuid, date, jsonb);
drop function if exists public.rpc_director_withdraw(uuid, numeric, date, uuid);
drop function if exists public.rpc_director_choice(uuid, text, numeric, date, uuid);
drop function if exists public.director_waiting(uuid);
drop function if exists public.director_account_balance(uuid);
drop view if exists public.director_accounts_v;

create or replace function public._money_account(t public.transactions, p_default text default null) returns uuid language plpgsql stable as $$
declare v uuid := t.bank_account_id; st text;
begin
  if v is null and p_default is not null then return public.acct(p_default); end if;
  if v is null then raise exception 'Choose the bank or cash account for this %', replace(t.type::text, '_', ' '); end if;
  select subtype into st from public.accounts where id = v;
  if st not in ('bank', 'cash', 'undeposited', 'credit_card') then raise exception 'Money can only move through a bank, cash, card or undeposited-funds account'; end if;
  return v;
end $$;

create or replace function public.company_capital_available()
returns table (contact_id uuid, name text, available numeric) language sql stable set search_path = public, pg_temp as $$
  with owed as (
    select j.contact_id, c.name, par.subtype, sum(j.home_credit - j.home_debit) amount
    from public.journal_lines j
    join public.accounts a on a.id = j.account_id
    join public.accounts par on par.id = a.parent_id
    join public.contacts c on c.id = j.contact_id
    join public.projects p on p.id = j.project_id
    where j.book = public.current_book() and par.subtype in ('capital_pool_loans', 'financing_return_payable', 'profit_share_payable')
      and 'partner' = any (c.kinds) and p.completed_at is not null and abs(public.client_balance(p.id)) < 0.005
    group by j.contact_id, c.name, par.subtype
  ), members as (
    select o.contact_id, o.name, sum(o.amount) available from owed o
    where o.subtype in ('financing_return_payable', 'profit_share_payable')
    group by o.contact_id, o.name having sum(o.amount) > 0
  ), money as (
    select coalesce(sum(j.home_debit - j.home_credit), 0) total
    from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.book = public.current_book() and a.subtype in ('bank', 'cash', 'undeposited')
  )
  select x.contact_id, x.name, x.available from (
    select m.contact_id, m.name, m.available, 0 k from members m
    union all
    select null::uuid, 'Company', greatest(y.total - coalesce((select sum(greatest(amount, 0)) from owed), 0), 0), 1 from money y
  ) x order by x.k, x.available desc, x.name
$$;

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

  -- each member's part, by what they have available; the company takes the rest (and every rounding laari)
  for d in select * from _cc_take where contact_id is not null and available > 0 order by available desc, name loop
    share_l := floor(amount_l * d.available / total)::bigint;
    if share_l <= 0 then continue; end if;
    given_l := given_l + share_l;
    -- paid out of their released returns and profit shares, project by project, oldest completion first; principal stays theirs
    lines := '[]'::jsonb; left_l := share_l;
    for r in select j.project_id, par.subtype, sum(j.home_credit - j.home_debit) owed, min(pr.completed_at) done
             from public.journal_lines j join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
             join public.projects pr on pr.id = j.project_id
             where j.book = public.current_book() and par.subtype in ('financing_return_payable', 'profit_share_payable')
               and j.contact_id = d.contact_id and pr.completed_at is not null and abs(public.client_balance(pr.id)) < 0.005
             group by j.project_id, par.subtype having sum(j.home_credit - j.home_debit) > 0
             order by min(pr.completed_at), j.project_id,
               case par.subtype when 'profit_share_payable' then 0 else 1 end loop
      exit when left_l <= 0;
      take := least(round(r.owed * 100)::bigint, left_l) / 100.0;
      lines := lines || jsonb_build_object('project_id', r.project_id, 'amount', take, 'contact_id', d.contact_id,
        'component', case r.subtype when 'profit_share_payable' then 'profit_share' else 'financing_return' end);
      left_l := left_l - round(take * 100)::bigint;
    end loop;
    v_payout := public.rpc_save_transaction(jsonb_build_object('type', 'payout', 'is_draft', true, 'date', p_date,
      'contact_id', d.contact_id, 'bank_account_id', p_bank, 'total_amount', share_l / 100.0,
      'reference', 'Reinvested in ' || p.code, 'memo', 'Returns and profit shares left in the company, put into ' || p.code || ' from the Capital Pool',
      'lines', lines));
    perform public._approve_payout(v_payout);
    v_contrib := public.rpc_save_transaction(jsonb_build_object('type', 'capital_contribution', 'date', p_date,
      'contact_id', d.contact_id, 'project_id', p_project, 'bank_account_id', p_bank, 'total_amount', share_l / 100.0,
      'reference', 'Capital Pool', 'memo', 'From returns and profit shares left in the company'));
    result := result || jsonb_build_object('contact_id', d.contact_id, 'name', d.name, 'amount', share_l / 100.0);
  end loop;

  if amount_l - given_l > 0 then
    insert into public.project_company_funding (project_id, date, amount, book) values (p_project, p_date, (amount_l - given_l) / 100.0, p.book);
    result := result || jsonb_build_object('contact_id', null, 'name', 'Company', 'amount', (amount_l - given_l) / 100.0);
  end if;
  return result;
end $$;
revoke execute on function public.rpc_finance_from_company_capital(uuid, date, numeric, uuid) from public, anon;
grant execute on function public.rpc_finance_from_company_capital(uuid, date, numeric, uuid) to authenticated;

update public.accounts set active = false where subtype = 'members_funds' and parent_id is null;
