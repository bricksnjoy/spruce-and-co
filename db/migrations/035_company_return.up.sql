-- 035 · The company's own Capital Pool money is a financing source like any other: its share of the
-- financing pool's profit is worked out and shown, and its principal counts as repaid once the
-- client has paid in full. Neither is posted: it is the company's money coming back to the company,
-- so its return stays in profit and its principal is already in the bank.

/** The company's financing return on p_profit: its own money's share of the financing pool, as split_profit divides it (030). */
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

revoke execute on function public.company_financing_return(uuid, numeric) from public, anon;
grant execute on function public.company_financing_return(uuid, numeric) to authenticated;
