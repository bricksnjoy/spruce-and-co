drop view if exists public.project_list_v;
create or replace function public.number_variation() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.number is null then
    select coalesce(max(number), 0) + 1 into new.number from public.variations where project_id = new.project_id;
  end if;
  if new.amount is null then new.amount := new.cost_impact; end if;
  return new;
end $$;
do $$
declare t text; pol record;
begin
  foreach t in array array['variations', 'budget_lines', 'billing_stages'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;
-- the policies as they were before 018
create policy variations_read on public.variations for select to authenticated using (public.is_staff());
create policy variations_ins on public.variations for insert to authenticated with check (public.can_write());
create policy variations_upd on public.variations for update to authenticated using (public.can_write());
create policy variations_del on public.variations for delete to authenticated using (public.is_admin());
create policy budget_lines_read on public.budget_lines for select to authenticated using (public.is_staff());
create policy budget_lines_ins on public.budget_lines for insert to authenticated with check (public.can_write());
create policy budget_lines_upd on public.budget_lines for update to authenticated using (public.can_write());
create policy budget_lines_del on public.budget_lines for delete to authenticated using (public.is_admin());
create policy billing_stages_read on public.billing_stages for select to authenticated using (public.is_staff());
create policy billing_stages_write on public.billing_stages for all to authenticated using (public.can_write()) with check (public.can_write());
