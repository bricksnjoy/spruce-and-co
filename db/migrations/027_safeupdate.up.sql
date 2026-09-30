-- 027 · Supabase runs API requests with safeupdate, which refuses a DELETE or
-- UPDATE without a WHERE clause — even inside a function. The split
-- adjustment cleared its scratch table with a bare DELETE, so any posting that
-- touched a completed project (a late cost, a bad debt, payroll labour) failed
-- through the app. Same function, with "where true"; nothing else changes.

create or replace function public.adjust_distribution(p_project uuid, p_reason text, p_date date default null) returns uuid language plpgsql set search_path = public, pg_temp as $$
declare base public.distributions; v_profit numeric; v_dist uuid;
begin
  select * into base from public.distributions where project_id = p_project and reason = 'completion';
  if not found then return null; end if;
  v_profit := public.project_profit(p_project);
  create temp table if not exists _split_delta (contact_id uuid, component text, amount numeric) on commit drop;
  delete from _split_delta where true;  -- safeupdate needs a WHERE
  insert into _split_delta
  select coalesce(t.contact_id, p.contact_id), coalesce(t.component, p.component), coalesce(t.amount, 0) - coalesce(p.amount, 0)
  from (select contact_id, component, amount from public.split_profit(p_project, v_profit)) t
  full join (select dl.contact_id, dl.component, sum(dl.amount) amount from public.distribution_lines dl
             join public.distributions d on d.id = dl.distribution_id where d.project_id = p_project group by 1, 2) p
    on p.contact_id = t.contact_id and p.component = t.component;
  if not exists (select 1 from _split_delta where amount <> 0) then return null; end if;
  insert into public.distributions (project_id, scheme_id, profit_amount, reason, adjusts_distribution_id, book)
  values (p_project, base.scheme_id, v_profit, p_reason, base.id, base.book) returning id into v_dist;
  insert into public.distribution_lines (distribution_id, contact_id, component, amount)
  select v_dist, contact_id, component, amount from _split_delta where amount <> 0;
  perform public._post_distribution(v_dist, coalesce(p_date, public.today_mv()));
  if p_reason = 'late_entry' then
    update public.projects set review_flag = 'Revenue or costs were posted after completion; the profit split was adjusted' where id = p_project;
  end if;
  return v_dist;
end $$;
