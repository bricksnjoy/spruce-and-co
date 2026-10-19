-- 018 · Projects screens (Phase 4, module 3).
-- • A project's variations, budget lines and billing stages follow its book:
--   you see and change them only for projects in the book you are working in.
-- • Variations get a reference by themselves (VO-01, VO-02 …) when none is typed.
-- • One view for the project list: value, billing, cost, forecast and stage.

alter table public.variations enable row level security;
alter table public.budget_lines enable row level security;

do $$
declare t text; pol record;
begin
  foreach t in array array['variations', 'budget_lines', 'billing_stages'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    -- the project must be visible to you, which already means it is in your book
    execute format($p$create policy %1$s_read on public.%1$I for select to authenticated
      using (public.is_staff() and exists (select 1 from public.projects p where p.id = project_id))$p$, t);
    execute format($p$create policy %1$s_ins on public.%1$I for insert to authenticated
      with check (public.can_write() and exists (select 1 from public.projects p where p.id = project_id))$p$, t);
    execute format($p$create policy %1$s_upd on public.%1$I for update to authenticated
      using (public.can_write() and exists (select 1 from public.projects p where p.id = project_id))
      with check (exists (select 1 from public.projects p where p.id = project_id))$p$, t);
    execute format($p$create policy %1$s_del on public.%1$I for delete to authenticated
      using (public.can_write() and exists (select 1 from public.projects p where p.id = project_id))$p$, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

create or replace function public.number_variation() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.number is null then
    select coalesce(max(number), 0) + 1 into new.number from public.variations where project_id = new.project_id;
  end if;
  if new.amount is null then new.amount := new.cost_impact; end if;
  if coalesce(trim(new.ref), '') = '' then new.ref := 'VO-' || lpad(new.number::text, 2, '0'); end if;
  return new;
end $$;

/** The project list: every figure from project_figures(), plus stage and customer. */
create or replace view public.project_list_v with (security_invoker = on) as
select v.*, p.archived_at, p.recognition_method, p.start_date, p.end_date, c.name as customer_name,
  public.project_stage(p.id) as stage
from public.project_value_v v
join public.projects p on p.id = v.id
left join public.contacts c on c.id = p.customer_id;

revoke all on public.project_list_v from anon;
