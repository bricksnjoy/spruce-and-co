drop function if exists public.rpc_set_financing_percent(uuid, numeric);

-- split_profit as 048 made it
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
    -- each financier's share of their own percentage (the scheme's pool unless set on the lender)
    for s in select f.contact_id cid, f.received, coalesce(c.profit_percent, pool_pct) pct from public.project_financing_v f join public.contacts c on c.id = f.contact_id
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


alter table public.transactions drop column if exists profit_percent;
