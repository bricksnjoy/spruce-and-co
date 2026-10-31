-- 052 · A deleted project's code can be used again.
-- A deleted project stays in the database, hidden, so its code still blocked a
-- new project from taking it, even after it was deleted for good. Codes are now
-- unique only among projects that are not deleted. The suggested next code
-- still skips a project that can be restored, and restoring one whose code has
-- since been taken by another project asks to change that project's code first.

drop index if exists public.projects_book_code;
create unique index projects_book_code on public.projects (book, code) where deleted_at is null;

/** The next free SC-### code: past every project, and past a deleted one that can still be restored. */
create or replace function public.next_project_code() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select 'SC-' || lpad(
    (coalesce(max(nullif(regexp_replace(p.code, '\D', '', 'g'), '')::int), 0) + 1)::text,
    3, '0')
  from public.projects p
  where public.is_staff() and p.book = public.current_book() and p.code ~ '^SC-\d+$'
    and (p.deleted_at is null
      or exists (select 1 from public.project_bin b where b.project_id = p.id and b.deleted_at >= now() - interval '30 days'))
$$;

/** Restoring a project whose code another project has taken since: say which, instead of a bare clash. */
create or replace function public._project_restore_code() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text;
begin
  select name into v from public.projects
  where book = new.book and code = new.code and deleted_at is null and id <> new.id;
  if found then
    raise exception 'Project code % is now used by %. Change that project''s code first, then restore this one', new.code, v;
  end if;
  return new;
end $$;

drop trigger if exists project_restore_code on public.projects;
create trigger project_restore_code before update of deleted_at on public.projects
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function public._project_restore_code();

revoke execute on function public._project_restore_code() from public, anon, authenticated;
revoke execute on function public.next_project_code() from public, anon;
grant execute on function public.next_project_code() to authenticated;
