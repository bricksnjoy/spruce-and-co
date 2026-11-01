-- 054 · Repaying a loan from the Capital Pool, and settling a person's money
-- one project at a time.
--
-- A lender can be repaid before the client has paid by the Capital Pool: any
-- directors' accounts and the company's own money, each part as chosen. The pool
-- part is a bridge: it waits in the project as that director's Capital Pool money
-- (or the company's), is paid back to the pool once the client pays (loans first,
-- before any return or profit share leaves), and earns no share of the profit;
-- the lender keeps the return their loan earned.
--
-- rpc_settle pays out or keeps one project's loan or earnings for one person:
-- 'take' pays it from a bank or cash account, 'keep' (a director) puts it in
-- their director's account for reinvesting.

create table public.pool_bridges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects,
  -- whose loan the pool repaid, and the repayment to them
  lender_id uuid not null references public.contacts,
  payout_id uuid references public.transactions,
  date date not null,
  amount numeric(18,2) not null check (amount > 0),
  book text not null default public.current_book() check (book in ('live', 'sandbox')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index pool_bridges_project on public.pool_bridges (project_id);

create table public.pool_bridge_parts (
  id uuid primary key default gen_random_uuid(),
  bridge_id uuid not null references public.pool_bridges on delete cascade,
  -- a director's part (put in from their director's account), or the company's own (null)
  contact_id uuid references public.contacts,
  amount numeric(18,2) not null check (amount > 0),
  contribution_id uuid references public.transactions,
  company_funding_id uuid references public.project_company_funding on delete set null
);
create index pool_bridge_parts_bridge on public.pool_bridge_parts (bridge_id);
create index pool_bridge_parts_contribution on public.pool_bridge_parts (contribution_id);
create index pool_bridge_parts_funding on public.pool_bridge_parts (company_funding_id);

alter table public.pool_bridges enable row level security;
alter table public.pool_bridge_parts enable row level security;
create policy pool_bridges_read on public.pool_bridges for select to authenticated using (public.is_staff() and book = public.current_book());
create policy pool_bridge_parts_read on public.pool_bridge_parts for select to authenticated
  using (exists (select 1 from public.pool_bridges b where b.id = bridge_id and public.is_staff() and b.book = public.current_book()));
revoke all on public.pool_bridges, public.pool_bridge_parts from anon;
grant select on public.pool_bridges, public.pool_bridge_parts to authenticated;

/** What each financier put into a project that earns a share: every loan and Capital Pool contribution but a bridge. */
create or replace function public.project_financing_shares(p_project uuid)
returns table (contact_id uuid, source_type text, received numeric) language sql stable set search_path = public, pg_temp as $$
  select j.contact_id, case par.subtype when 'project_loans' then 'external' else 'capital_pool' end, sum(j.home_credit)
  from public.journal_lines j
  join public.accounts a on a.id = j.account_id
  join public.accounts par on par.id = a.parent_id
  where par.subtype in ('project_loans', 'capital_pool_loans') and j.project_id = p_project
    and not exists (select 1 from public.pool_bridge_parts b where b.contribution_id = j.transaction_id)
  group by j.contact_id, par.subtype
$$;

/** The company's own money in a project that earns a share (a bridge does not). */
create or replace function public.company_funding_shares(p_project uuid) returns numeric language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(cf.amount), 0) from public.project_company_funding cf
  where cf.project_id = p_project and not exists (select 1 from public.pool_bridge_parts b where b.company_funding_id = cf.id)
$$;

/** As in 049, with a Capital Pool bridge left out of the financing that shares the profit. */
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
  select coalesce(sum(f.received), 0) into fin_total from public.project_financing_shares(p_project) f;
  -- the company's own part shares by amount too; its return is not posted, so it stays as profit
  fin_total := fin_total + public.company_funding_shares(p_project);
  if fin_total > 0 then
    -- each financier's share of their own percentage (the scheme's pool unless set on the loan)
    for s in select f.contact_id cid, f.received,
               -- each loan's own percentage (blank is the pool's), weighted by its amount
               coalesce((select sum(coalesce(t.profit_percent, pool_pct) * t.total_amount) / nullif(sum(t.total_amount), 0)
                         from public.transactions t
                         where t.project_id = p_project and t.contact_id = f.contact_id and t.voided_at is null
                           and t.type in ('loan_receipt', 'capital_contribution')
                           and not exists (select 1 from public.pool_bridge_parts b where b.contribution_id = t.id)), pool_pct) pct
             from public.project_financing_shares(p_project) f join public.contacts c on c.id = f.contact_id
             where f.received > 0 order by f.received desc, c.name loop
      contact_id := s.cid; party_type := 'financing_pool'; component := 'financing_return';
      amount := floor(floor(profit_l * s.pct / 100) * s.received / fin_total)::bigint / 100.0;
      if amount > 0 then return next; end if;
    end loop;
  end if;
  for s in select sa.contact_id cid, sa.percent from public.scheme_allocations sa where sa.scheme_id = v_scheme and sa.party_type = 'person' order by sa.sort_order loop
    contact_id := s.cid; party_type := 'person'; component := 'profit_share';
    amount := floor(profit_l * s.percent / 100)::bigint / 100.0;
    if amount > 0 then return next; end if;
  end loop;
end $$;

/** As in 035, with a Capital Pool bridge left out. */
create or replace function public.company_financing_return(p_project uuid, p_profit numeric)
returns numeric language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_scheme uuid; profit_l bigint; pool_pct numeric; pool_l bigint; own numeric; fin_total numeric;
begin
  if coalesce(p_profit, 0) <= 0 then return 0; end if;
  own := public.company_funding_shares(p_project);
  if own <= 0 then return 0; end if;
  select coalesce(p.scheme_id, public.scheme_on(coalesce(p.start_date, current_date))) into v_scheme from public.projects p where p.id = p_project;
  profit_l := round(p_profit * 100)::bigint;
  select coalesce(sum(sa.percent), 0) into pool_pct from public.scheme_allocations sa where sa.scheme_id = v_scheme and sa.party_type = 'financing_pool';
  pool_l := floor(profit_l * pool_pct / 100)::bigint;
  select coalesce(sum(f.received), 0) + own into fin_total from public.project_financing_shares(p_project) f;
  return floor(pool_l * own / fin_total)::bigint / 100.0;
end $$;

/** As in 053; a loan repaid by a Capital Pool bridge may be repaid before the client has paid. */
create or replace function public._payout_gate(t public.transactions) returns void language plpgsql set search_path = public, pg_temp as $$
declare r record; cb numeric; owed numeric; v_acct uuid; v_loans numeric;
begin
  for r in select coalesce(l.project_id, t.project_id) pid, coalesce(l.contact_id, t.contact_id) cid, l.component, sum(l.amount) amt
           from public.transaction_lines l where l.transaction_id = t.id group by 1, 2, 3 loop
    -- loans can be repaid once the client has paid, before completion; profit only after it
    if r.component <> 'principal' and not exists (select 1 from public.projects where id = r.pid and completed_at is not null) then
      raise exception 'Profit is paid once the project is completed' using errcode = 'P0001';
    end if;
    cb := public.client_balance(r.pid);
    if abs(cb) >= 0.005 and not (r.component = 'principal' and coalesce(current_setting('app.pool_bridge', true), '') = 'on') then
      raise exception 'Payout blocked: the client still owes MVR % on %', to_char(cb, 'FM999,999,999,990.00'),
        (select code from public.projects where id = r.pid) using errcode = 'P0001';
    end if;
    -- loans are repaid first: no return or profit leaves while a loan to the project is owed
    -- (principal repaid in this same payout counts as repaid)
    if r.component <> 'principal' then
      v_loans := public.project_loans_owed(r.pid, t.id) - coalesce((select sum(l.amount) from public.transaction_lines l
        where l.transaction_id = t.id and l.component = 'principal' and coalesce(l.project_id, t.project_id) = r.pid), 0);
      if v_loans > 0.005 then
        raise exception 'Repay the loans first: MVR % lent to % is still to repay', to_char(v_loans, 'FM999,999,999,990.00'),
          (select code from public.projects where id = r.pid) using errcode = 'P0001';
      end if;
    end if;
    v_acct := case r.component
      when 'principal' then public._principal_account(r.cid, r.pid, t.id)
      when 'financing_return' then public.sub_account('financing_return_payable', r.cid)
      else public.sub_account('profit_share_payable', r.cid) end;
    select coalesce(sum(home_credit - home_debit), 0) into owed from public.journal_lines
      where account_id = v_acct and project_id = r.pid and transaction_id <> t.id;
    if r.amt > owed + 0.005 then
      raise exception 'That is more than the MVR % owed to % for this', to_char(owed, 'FM999,999,999,990.00'),
        (select name from public.contacts where id = r.cid) using errcode = 'P0001';
    end if;
  end loop;
end $$;

/** What a person is owed on one project, by component (principal, financing_return, profit_share). */
create or replace function public.owed_on_project(p_contact uuid, p_project uuid)
returns table (component text, owed numeric) language sql stable set search_path = public, pg_temp as $$
  select case par.subtype when 'financing_return_payable' then 'financing_return' when 'profit_share_payable' then 'profit_share' else 'principal' end,
    sum(j.home_credit - j.home_debit)
  from public.journal_lines j join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
  where j.project_id = p_project and j.contact_id = p_contact
    and par.subtype in ('project_loans', 'capital_pool_loans', 'financing_return_payable', 'profit_share_payable')
  group by 1
$$;

/**
 * Repay p_contact's loan on p_project from the Capital Pool before the client has
 * paid (admin only). p_parts is [{contact_id, amount}]: a director's part comes
 * from their director's account, the company's (contact_id null) from its own
 * money. The loan is repaid from p_bank for the parts' total.
 */
create or replace function public.rpc_repay_from_capital_pool(p_contact uuid, p_project uuid, p_date date, p_bank uuid, p_parts jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.projects; c public.contacts; part jsonb; v_contact uuid; v_amt numeric; v_total numeric := 0; v_company numeric := 0;
  v_have numeric; v_name text; v_owed numeric; v_bridge uuid; v_id uuid; v_payout uuid;
begin
  perform public.require_role('admin');
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'No such project'; end if;
  perform public._require_book(p.book);
  select * into c from public.contacts where id = p_contact;
  if not found then raise exception 'No such lender'; end if;
  if p_date is null then raise exception 'Enter the date'; end if;
  if not exists (select 1 from public.accounts where id = p_bank and subtype in ('bank', 'cash')) then
    raise exception 'Choose the bank or cash account the loan is repaid from';
  end if;
  if abs(public.client_balance(p_project)) < 0.005 then
    raise exception 'The client has paid for %: repay the loan from the project''s money', p.code;
  end if;
  if jsonb_typeof(p_parts) <> 'array' then raise exception 'Enter how much comes from each'; end if;
  for part in select * from jsonb_array_elements(p_parts) loop
    v_amt := round(coalesce((part ->> 'amount')::numeric, 0), 2);
    if v_amt < 0 then raise exception 'Amounts cannot be negative'; end if;
    v_total := v_total + v_amt;
    if nullif(part ->> 'contact_id', '') is null then v_company := v_company + v_amt; end if;
  end loop;
  if v_total <= 0 then raise exception 'Enter how much comes from at least one'; end if;
  select coalesce(sum(owed), 0) into v_owed from public.owed_on_project(p_contact, p_project) where component = 'principal';
  if v_total > v_owed + 0.005 then
    raise exception '% has MVR % of their loan on % to repay; that is the most this can be', c.name, to_char(v_owed, 'FM999,999,999,990.00'), p.code;
  end if;
  -- the company's own money is checked before anything moves
  if v_company > 0 then
    select available into v_have from public.company_capital_available() where contact_id is null;
    if v_company > coalesce(v_have, 0) + 0.005 then
      raise exception 'The company has MVR % of its own to put in; that is the most its part can be', to_char(coalesce(v_have, 0), 'FM999,999,999,990.00');
    end if;
  end if;

  insert into public.pool_bridges (project_id, lender_id, date, amount, book) values (p_project, p_contact, p_date, v_total, p.book) returning id into v_bridge;
  for part in select * from jsonb_array_elements(p_parts) loop
    v_amt := round(coalesce((part ->> 'amount')::numeric, 0), 2);
    continue when v_amt <= 0;
    v_contact := nullif(part ->> 'contact_id', '')::uuid;
    if v_contact is null then
      insert into public.project_company_funding (project_id, date, amount, book) values (p_project, p_date, v_amt, p.book) returning id into v_id;
      insert into public.pool_bridge_parts (bridge_id, contact_id, amount, company_funding_id) values (v_bridge, null, v_amt, v_id);
    else
      select name into v_name from public.contacts where id = v_contact and 'partner' = any (kinds);
      if v_name is null then raise exception 'Only Capital Pool members put money in from a director''s account'; end if;
      v_have := public.director_account_balance(v_contact);
      if v_amt > v_have + 0.005 then
        raise exception '% has MVR % in their director''s account; that is the most their part can be', v_name, to_char(v_have, 'FM999,999,999,990.00');
      end if;
      v_id := public.rpc_save_transaction(jsonb_build_object('type', 'capital_contribution', 'date', p_date,
        'contact_id', v_contact, 'project_id', p_project, 'bank_account_id', public.sub_account('members_funds', v_contact),
        'total_amount', v_amt, 'reference', 'Capital Pool bridge',
        'memo', 'Repaid ' || c.name || '''s loan on ' || p.code || ' from ' || v_name || '''s director''s account; paid back when the client pays'));
      insert into public.pool_bridge_parts (bridge_id, contact_id, amount, contribution_id) values (v_bridge, v_contact, v_amt, v_id);
    end if;
  end loop;

  perform set_config('app.pool_bridge', 'on', true);
  v_payout := public.rpc_save_payout(jsonb_build_object('date', p_date, 'contact_id', p_contact, 'bank_account_id', p_bank,
    'reference', 'Capital Pool', 'memo', 'Loan on ' || p.code || ' repaid from the Capital Pool',
    'lines', jsonb_build_array(jsonb_build_object('project_id', p_project, 'component', 'principal', 'amount', v_total))));
  perform set_config('app.pool_bridge', '', true);
  update public.pool_bridges set payout_id = v_payout where id = v_bridge;
  return v_payout;
end $$;

/**
 * Settle one person's money on one project (an admin's is paid at once, anyone
 * else's waits for approval): p_what 'principal' (their loan) or 'earnings'
 * (financing return first, then profit share), up to p_amount. p_choice 'take'
 * pays it from p_bank; 'keep' (a director) puts it in their director's account.
 */
create or replace function public.rpc_settle(p_contact uuid, p_project uuid, p_what text, p_choice text, p_amount numeric, p_date date, p_bank uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.contacts; v_code text; v_money uuid; v_left numeric; v_take numeric; r record; lines jsonb := '[]'::jsonb;
begin
  perform public.require_role('write');
  select * into c from public.contacts where id = p_contact;
  if not found then raise exception 'No one to pay'; end if;
  select code into v_code from public.projects where id = p_project;
  if v_code is null then raise exception 'No such project'; end if;
  perform public._require_book((select book from public.projects where id = p_project));
  if p_what not in ('principal', 'earnings') then raise exception 'Choose the loan or the earnings'; end if;
  if p_choice not in ('take', 'keep') then raise exception 'Choose to take it out or keep it in the company'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount'; end if;
  if p_date is null then raise exception 'Enter the date'; end if;
  if p_choice = 'keep' then
    if not ('partner' = any (c.kinds)) then raise exception 'Only a director keeps money in the company'; end if;
    v_money := public.sub_account('members_funds', p_contact);
  else
    if not exists (select 1 from public.accounts where id = p_bank and subtype in ('bank', 'cash')) then
      raise exception 'Choose the bank or cash account it is paid from';
    end if;
    v_money := p_bank;
  end if;
  v_left := round(p_amount, 2);
  for r in select o.component, o.owed from public.owed_on_project(p_contact, p_project) o
           where o.owed > 0.005 and (o.component = 'principal') = (p_what = 'principal')
           order by case o.component when 'principal' then 0 when 'financing_return' then 1 else 2 end loop
    exit when v_left <= 0;
    v_take := least(r.owed, v_left);
    lines := lines || jsonb_build_object('project_id', p_project, 'component', r.component, 'amount', v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0.005 then
    raise exception 'That is more than the MVR % owed to % for this', to_char(round(p_amount, 2) - v_left, 'FM999,999,999,990.00'), c.name;
  end if;
  return public.rpc_save_payout(jsonb_build_object('date', p_date, 'contact_id', p_contact, 'bank_account_id', v_money,
    'reference', case p_choice when 'keep' then 'Kept in the company' end,
    'memo', case p_choice when 'keep' then 'Kept in the company, in ' || c.name || '''s director''s account' else 'Paid to ' || c.name end
      || case p_what when 'principal' then ' · loan on ' else ' · earnings on ' end || v_code,
    'lines', lines));
end $$;

revoke execute on function public.project_financing_shares(uuid) from public, anon;
revoke execute on function public.company_funding_shares(uuid) from public, anon;
revoke execute on function public.owed_on_project(uuid, uuid) from public, anon;
revoke execute on function public.rpc_repay_from_capital_pool(uuid, uuid, date, uuid, jsonb) from public, anon;
revoke execute on function public.rpc_settle(uuid, uuid, text, text, numeric, date, uuid) from public, anon;
grant execute on function public.project_financing_shares(uuid) to authenticated;
grant execute on function public.company_funding_shares(uuid) to authenticated;
grant execute on function public.owed_on_project(uuid, uuid) to authenticated;
grant execute on function public.rpc_repay_from_capital_pool(uuid, uuid, date, uuid, jsonb) to authenticated;
grant execute on function public.rpc_settle(uuid, uuid, text, text, numeric, date, uuid) to authenticated;
