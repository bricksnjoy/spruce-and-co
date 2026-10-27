-- Projects still in the bin come back into view with their documents void.
drop function if exists public.deleted_projects();
drop function if exists public.rpc_restore_project(uuid);
drop function if exists public.rpc_delete_project(uuid, text);
drop function if exists public._check_director_accounts(text, text);
drop table if exists public.project_bin;

drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select using (public.is_staff() and book = public.current_book());
drop policy if exists projects_upd on public.projects;
create policy projects_upd on public.projects for update
  using (public.can_write() and book = public.current_book()) with check (book = public.current_book());
drop policy if exists transactions_read on public.transactions;
create policy transactions_read on public.transactions for select to authenticated
  using (public.is_staff() and book = public.current_book() and (not public._payroll_type(type) or public.has_payroll()));
do $$
declare t text;
begin
  foreach t in array array['project_tasks', 'project_phases', 'milestones'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_read', t);
      execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_read', t);
    end if;
  end loop;
end $$;
drop function if exists public.project_deleted(uuid);

alter table public.transactions drop column if exists deleted_with;
alter table public.projects drop column if exists deleted_by;
alter table public.projects drop column if exists deleted_at;
