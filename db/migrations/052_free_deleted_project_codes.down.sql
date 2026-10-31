drop trigger if exists project_restore_code on public.projects;
drop function if exists public._project_restore_code();
create or replace function public.next_project_code() returns text language sql stable security invoker set search_path = public, pg_temp as $$
  select 'SC-' || lpad(
    (coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::int), 0) + 1)::text,
    3, '0')
  from projects
  where code ~ '^SC-\d+$'
$$;
drop index if exists public.projects_book_code;
create unique index projects_book_code on public.projects (book, code);
