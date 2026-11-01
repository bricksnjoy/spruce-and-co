-- back to 053's gate, 049's split and 035's company return
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
    if abs(cb) >= 0.005 then
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
  if fin_total > 0 then
    -- each financier's share of their own percentage (the scheme's pool unless set on the loan)
    for s in select f.contact_id cid, f.received,
               -- each loan's own percentage (blank is the pool's), weighted by its amount
               coalesce((select sum(coalesce(t.profit_percent, pool_pct) * t.total_amount) / nullif(sum(t.total_amount), 0)
                         from public.transactions t
                         where t.project_id = p_project and t.contact_id = f.contact_id and t.voided_at is null
                           and t.type in ('loan_receipt', 'capital_contribution')), pool_pct) pct
             from public.project_financing_v f join public.contacts c on c.id = f.contact_id
             where f.project_id = p_project and f.received > 0 order by f.received desc, c.name loop
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

create or replace function public.company_financing_return(p_project uuid, p_profit numeric)
returns numeric language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_scheme uuid; profit_l bigint; pool_pct numeric; pool_l bigint; own numeric; fin_total numeric;
begin
  if coalesce(p_profit, 0) <= 0 then return 0; end if;
  own := coalesce((select sum(cf.amount) from public.project_company_funding cf where cf.project_id = p_project), 0);
  if own <= 0 then return 0; end if;
  select coalesce(p.scheme_id, public.scheme_on(coalesce(p.start_date, current_date))) into v_scheme from public.projects p where p.id = p_project;
  profit_l := round(p_profit * 100)::bigint;
  select coalesce(sum(sa.percent), 0) into pool_pct from public.scheme_allocations sa where sa.scheme_id = v_scheme and sa.party_type = 'financing_pool';
  pool_l := floor(profit_l * pool_pct / 100)::bigint;
  select coalesce(sum(f.received), 0) + own into fin_total from public.project_financing_v f where f.project_id = p_project;
  return floor(pool_l * own / fin_total)::bigint / 100.0;
end $$;

drop function if exists public.rpc_settle(uuid, uuid, text, text, numeric, date, uuid);
drop function if exists public.rpc_repay_from_capital_pool(uuid, uuid, date, uuid, jsonb);
drop function if exists public.owed_on_project(uuid, uuid);
drop function if exists public.company_funding_shares(uuid);
drop function if exists public.project_financing_shares(uuid);
drop table if exists public.pool_bridge_parts;
drop table if exists public.pool_bridges;
