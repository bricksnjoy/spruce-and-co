-- 039 · Directors' accounts. Once a project is completed and the client has paid
-- in full, each Capital Pool member's principal, financing return and profit share
-- from it waits for their choice: keep it in the company or take it out now.
-- Money kept in the company sits in their own director's account (a liability to
-- them, under 2750 Directors' Accounts; the cash stays in the bank), and from there
-- it is taken out or reinvested in another project, each member putting in the
-- amount chosen for them. Principal is theirs to keep in or take out like the rest.
--
-- Keeping money in is a payout into the director's account (so each person's
-- payables still equal their distributions less payouts); taking it out of the
-- account is a journal to the bank; reinvesting is a Capital Pool contribution
-- paid from the account. Financing from the pool is now rpc_finance_from_capital_pool,
-- with each part as chosen; the automatic sharing of 030 and 034 is retired.

insert into public.accounts (code, name, type, subtype, currency, budget_category, is_system)
select '2750', 'Directors'' Accounts', 'liability', 'members_funds', 'MVR', null, true
where not exists (select 1 from public.accounts where subtype = 'members_funds' and parent_id is null);
update public.accounts set active = true where subtype = 'members_funds' and parent_id is null;

/** As in 005, and a payout or Capital Pool contribution may also move through the person's own director's account (039). */
create or replace function public._money_account(t public.transactions, p_default text default null) returns uuid language plpgsql stable as $$
declare v uuid := t.bank_account_id; st text;
begin
  if v is null and p_default is not null then return public.acct(p_default); end if;
  if v is null then raise exception 'Choose the bank or cash account for this %', replace(t.type::text, '_', ' '); end if;
  if t.type in ('payout', 'capital_contribution') and exists (
    select 1 from public.accounts a join public.accounts par on par.id = a.parent_id
    where a.id = v and par.subtype = 'members_funds' and a.contact_id = t.contact_id) then
    return v;
  end if;
  select subtype into st from public.accounts where id = v;
  if st not in ('bank', 'cash', 'undeposited', 'credit_card') then raise exception 'Money can only move through a bank, cash, card or undeposited-funds account'; end if;
  return v;
end $$;

/** What a member has in their director's account, in the current book. */
create or replace function public.director_account_balance(p_contact uuid) returns numeric language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(j.home_credit - j.home_debit), 0)
  from public.journal_lines j join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
  where j.book = public.current_book() and par.subtype = 'members_funds' and a.contact_id = p_contact
$$;

/** Each member's director's account, in the current book. */
create or replace view public.director_accounts_v with (security_invoker = on) as
select j.book, a.contact_id, sum(j.home_credit - j.home_debit) as balance
from public.journal_lines j join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
where par.subtype = 'members_funds'
group by j.book, a.contact_id;
grant select on public.director_accounts_v to authenticated;

/**
 * What waits for a member's choice: their principal, financing return and profit
 * share on projects completed and paid in full by the client, oldest completion first.
 */
create or replace function public.director_waiting(p_contact uuid)
returns table (project_id uuid, component text, amount numeric, completed_at timestamptz) language sql stable set search_path = public, pg_temp as $$
  select j.project_id,
    case par.subtype when 'capital_pool_loans' then 'principal' when 'financing_return_payable' then 'financing_return' else 'profit_share' end,
    sum(j.home_credit - j.home_debit), min(p.completed_at)
  from public.journal_lines j
  join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
  join public.projects p on p.id = j.project_id
  where j.book = public.current_book() and j.contact_id = p_contact
    and par.subtype in ('capital_pool_loans', 'financing_return_payable', 'profit_share_payable')
    and p.completed_at is not null and abs(public.client_balance(p.id)) < 0.005
  group by j.project_id, par.subtype
  having sum(j.home_credit - j.home_debit) > 0
  order by min(p.completed_at), j.project_id,
    case par.subtype when 'profit_share_payable' then 0 when 'financing_return_payable' then 1 else 2 end
$$;

/**
 * A member's choice for p_amount of what waits for them (admin only): 'keep' puts
 * it in their director's account, 'take' pays it to them from p_bank. It is taken
 * from their projects oldest completion first: profit share, then return, then principal.
 */
create or replace function public.rpc_director_choice(p_contact uuid, p_choice text, p_amount numeric, p_date date, p_bank uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.contacts; v_waiting numeric; left_l bigint; take_l bigint; r record; lines jsonb := '[]'::jsonb; v_money uuid; v_id uuid;
begin
  perform public.require_role('admin');
  select * into c from public.contacts where id = p_contact;
  if not found or not ('partner' = any (c.kinds)) then raise exception 'Choose a Capital Pool member'; end if;
  if p_choice not in ('keep', 'take') then raise exception 'Choose to keep it in the company or take it out'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount'; end if;
  if p_date is null then raise exception 'Enter the date'; end if;
  select coalesce(sum(amount), 0) into v_waiting from public.director_waiting(p_contact);
  if p_amount > v_waiting + 0.005 then
    raise exception '% has MVR % waiting; that is the most this can be', c.name, to_char(v_waiting, 'FM999,999,999,990.00');
  end if;
  if p_choice = 'keep' then
    v_money := public.sub_account('members_funds', p_contact);
  else
    if not exists (select 1 from public.accounts where id = p_bank and subtype in ('bank', 'cash')) then
      raise exception 'Choose the bank or cash account it is paid from';
    end if;
    v_money := p_bank;
  end if;
  left_l := round(p_amount * 100)::bigint;
  for r in select * from public.director_waiting(p_contact) loop
    exit when left_l <= 0;
    take_l := least(round(r.amount * 100)::bigint, left_l);
    lines := lines || jsonb_build_object('project_id', r.project_id, 'component', r.component, 'contact_id', p_contact, 'amount', take_l / 100.0);
    left_l := left_l - take_l;
  end loop;
  v_id := public.rpc_save_transaction(jsonb_build_object('type', 'payout', 'is_draft', true, 'date', p_date,
    'contact_id', p_contact, 'bank_account_id', v_money, 'total_amount', p_amount,
    'reference', case p_choice when 'keep' then 'Kept in the company' else 'Taken out' end,
    'memo', case p_choice when 'keep' then 'Kept in the company, in ' || c.name || '''s director''s account' else 'Paid to ' || c.name end,
    'lines', lines));
  perform public._approve_payout(v_id);
  return v_id;
end $$;

/** Pay a member p_amount out of their director's account from p_bank (admin only). */
create or replace function public.rpc_director_withdraw(p_contact uuid, p_amount numeric, p_date date, p_bank uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.contacts; v_bal numeric;
begin
  perform public.require_role('admin');
  select * into c from public.contacts where id = p_contact;
  if not found or not ('partner' = any (c.kinds)) then raise exception 'Choose a Capital Pool member'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount'; end if;
  if p_date is null then raise exception 'Enter the date'; end if;
  if not exists (select 1 from public.accounts where id = p_bank and subtype in ('bank', 'cash')) then
    raise exception 'Choose the bank or cash account it is paid from';
  end if;
  v_bal := public.director_account_balance(p_contact);
  if p_amount > v_bal + 0.005 then
    raise exception '% has MVR % in their director''s account; that is the most this can be', c.name, to_char(v_bal, 'FM999,999,999,990.00');
  end if;
  return public.rpc_save_transaction(jsonb_build_object('type', 'journal', 'date', p_date, 'contact_id', p_contact,
    'reference', 'Director''s account', 'memo', 'Paid to ' || c.name || ' from their director''s account',
    'lines', jsonb_build_array(
      jsonb_build_object('account_id', public.sub_account('members_funds', p_contact), 'debit', p_amount, 'contact_id', p_contact),
      jsonb_build_object('account_id', p_bank, 'credit', p_amount))));
end $$;

/**
 * What can finance a project from the Capital Pool, in the current book: each
 * member's director's account, and the company's own money — bank, cash and
 * payments not yet banked, less everything owed to members and lenders on any
 * project (principal, returns and profit shares) and in directors' accounts, and
 * less what the company has put into projects not yet completed and paid for.
 */
create or replace function public.company_capital_available()
returns table (contact_id uuid, name text, available numeric) language sql stable set search_path = public, pg_temp as $$
  with members as (
    select d.contact_id, c.name, d.balance available
    from public.director_accounts_v d join public.contacts c on c.id = d.contact_id
    where d.book = public.current_book() and d.balance > 0.005
  ), owed as (
    select coalesce(sum(j.home_credit - j.home_debit), 0) total
    from public.journal_lines j join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
    where j.book = public.current_book()
      and par.subtype in ('project_loans', 'capital_pool_loans', 'financing_return_payable', 'profit_share_payable', 'members_funds')
  ), committed as (
    select coalesce(sum(f.amount), 0) total
    from public.project_company_funding f join public.projects p on p.id = f.project_id
    where f.book = public.current_book() and not (p.completed_at is not null and abs(public.client_balance(p.id)) < 0.005)
  ), money as (
    select coalesce(sum(j.home_debit - j.home_credit), 0) total
    from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.book = public.current_book() and a.subtype in ('bank', 'cash', 'undeposited')
  )
  select x.contact_id, x.name, x.available from (
    select m.contact_id, m.name, m.available, 0 k from members m
    union all
    select null::uuid, 'Company', greatest(y.total - o.total - f.total, 0), 1 from money y, owed o, committed f
  ) x order by x.k, x.available desc, x.name
$$;

/**
 * Finance a project from the Capital Pool (admin only), each part as chosen:
 * p_parts is [{contact_id, amount}], a member's part paid from their director's
 * account and the company's own part (contact_id null) from its money.
 */
create or replace function public.rpc_finance_from_capital_pool(p_project uuid, p_date date, p_parts jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.projects; part jsonb; v_contact uuid; v_amt numeric; v_have numeric; v_name text; result jsonb := '[]'::jsonb; n int := 0;
begin
  perform public.require_role('admin');
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'No such project'; end if;
  perform public._require_book(p.book);
  if p.completed_at is not null then raise exception 'This project is completed; it takes no more financing'; end if;
  if p_date is null then raise exception 'Enter the date'; end if;
  if jsonb_typeof(p_parts) <> 'array' then raise exception 'Enter how much comes from each'; end if;
  -- the company's own money is checked first, before members' parts change what it holds
  select coalesce(sum((x ->> 'amount')::numeric), 0) into v_amt from jsonb_array_elements(p_parts) x
    where nullif(x ->> 'contact_id', '') is null and coalesce((x ->> 'amount')::numeric, 0) > 0;
  if v_amt > 0 then
    select available into v_have from public.company_capital_available() where contact_id is null;
    if v_amt > coalesce(v_have, 0) + 0.005 then
      raise exception 'The company has MVR % of its own to put in; that is the most its part can be', to_char(coalesce(v_have, 0), 'FM999,999,999,990.00');
    end if;
  end if;
  for part in select * from jsonb_array_elements(p_parts) loop
    v_amt := round(coalesce((part ->> 'amount')::numeric, 0), 2);
    continue when v_amt <= 0;
    v_contact := nullif(part ->> 'contact_id', '')::uuid;
    n := n + 1;
    if v_contact is null then
      insert into public.project_company_funding (project_id, date, amount, book) values (p_project, p_date, v_amt, p.book);
      result := result || jsonb_build_object('contact_id', null, 'name', 'Company', 'amount', v_amt);
    else
      select name into v_name from public.contacts where id = v_contact and 'partner' = any (kinds);
      if v_name is null then raise exception 'Only Capital Pool members put money in from a director''s account'; end if;
      v_have := public.director_account_balance(v_contact);
      if v_amt > v_have + 0.005 then
        raise exception '% has MVR % in their director''s account; that is the most their part can be', v_name, to_char(v_have, 'FM999,999,999,990.00');
      end if;
      perform public.rpc_save_transaction(jsonb_build_object('type', 'capital_contribution', 'date', p_date,
        'contact_id', v_contact, 'project_id', p_project, 'bank_account_id', public.sub_account('members_funds', v_contact),
        'total_amount', v_amt, 'reference', 'Capital Pool', 'memo', 'Reinvested from ' || v_name || '''s director''s account'));
      result := result || jsonb_build_object('contact_id', v_contact, 'name', v_name, 'amount', v_amt);
    end if;
  end loop;
  if n = 0 then raise exception 'Enter how much comes from at least one'; end if;
  return result;
end $$;

drop function if exists public.rpc_finance_from_company_capital(uuid, date, numeric, uuid);

revoke execute on function public.director_account_balance(uuid) from public, anon;
revoke execute on function public.director_waiting(uuid) from public, anon;
revoke execute on function public.rpc_director_choice(uuid, text, numeric, date, uuid) from public, anon;
revoke execute on function public.rpc_director_withdraw(uuid, numeric, date, uuid) from public, anon;
revoke execute on function public.rpc_finance_from_capital_pool(uuid, date, jsonb) from public, anon;
grant execute on function public.director_account_balance(uuid) to authenticated;
grant execute on function public.director_waiting(uuid) to authenticated;
grant execute on function public.rpc_director_choice(uuid, text, numeric, date, uuid) to authenticated;
grant execute on function public.rpc_director_withdraw(uuid, numeric, date, uuid) to authenticated;
grant execute on function public.rpc_finance_from_capital_pool(uuid, date, jsonb) to authenticated;
