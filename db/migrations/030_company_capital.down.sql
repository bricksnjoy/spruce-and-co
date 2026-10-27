-- Removes company-capital financing and restores the profit split of 009 (with 014's fixed search_path).
create or replace function public.split_profit(p_project uuid, p_profit numeric)
returns table (contact_id uuid, party_type text, component text, amount numeric) language plpgsql stable as $$
declare
  v_scheme uuid; profit_l bigint; pool_pct numeric; pool_l bigint; fin_total numeric; s record;
begin
  if coalesce(p_profit, 0) <= 0 then return; end if;
  select coalesce(p.scheme_id, public.scheme_on(coalesce(p.start_date, current_date))) into v_scheme from public.projects p where p.id = p_project;
  profit_l := round(p_profit * 100)::bigint;
  select coalesce(sum(sa.percent), 0) into pool_pct from public.scheme_allocations sa where sa.scheme_id = v_scheme and sa.party_type = 'financing_pool';
  pool_l := floor(profit_l * pool_pct / 100)::bigint;
  select coalesce(sum(f.received), 0) into fin_total from public.project_financing_v f where f.project_id = p_project;
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
alter function public.split_profit(uuid, numeric) set search_path = public, pg_temp;
drop function if exists public.rpc_finance_from_company_capital(uuid, date, numeric, uuid);
drop function if exists public.company_funding(uuid);
drop function if exists public.company_capital_available();
drop table if exists public.project_company_funding;
