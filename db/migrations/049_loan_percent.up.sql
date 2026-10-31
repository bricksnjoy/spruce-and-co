-- 049 · The profit percentage belongs to each loan, not to the lender: a 0% on
-- one loan no longer carries to the lender's other projects. Each entry keeps
-- its own (blank is the scheme's pool, 20%); a financier with several entries
-- in one project takes their amount-weighted percentage. The lender's own
-- percentage (048) is put on the loan it was typed with: their latest lender loan
-- (Capital Pool money never asked for one, so it keeps the pool's 20%).
alter table public.transactions add column profit_percent numeric(5,2)
  check (profit_percent is null or (profit_percent >= 0 and profit_percent <= 100));

update public.transactions t set profit_percent = c.profit_percent
from public.contacts c
where c.id = t.contact_id and c.profit_percent is not null
  and t.id = (select x.id from public.transactions x
              where x.contact_id = c.id and x.type = 'loan_receipt' and x.voided_at is null
              order by x.created_at desc limit 1);

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


/** Set a loan's profit percentage (null is the scheme's pool). */
create or replace function public.rpc_set_financing_percent(p_id uuid, p_percent numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transactions;
begin
  select * into t from public.transactions where id = p_id;
  if not found or t.type not in ('loan_receipt', 'capital_contribution') then raise exception 'No such loan'; end if;
  perform public._require_book(t.book);
  perform public.require_role('write');
  update public.transactions set profit_percent = p_percent where id = p_id;
end $$;
revoke execute on function public.rpc_set_financing_percent(uuid, numeric) from public, anon;
grant execute on function public.rpc_set_financing_percent(uuid, numeric) to authenticated;
