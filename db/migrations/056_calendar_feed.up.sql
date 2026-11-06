-- 056 · The calendar feed Google Calendar subscribes to reads the open project
-- tasks and milestones with the bot's key (no one is signed in when Google
-- fetches it). The tables are Live's own (not in every copy of the database),
-- so they are read only where they exist.

/** Open project tasks with a due date and milestones still to reach, for the calendar feed (the bot only). */
create or replace function public.bot_calendar_items(p_key text)
returns table (kind text, id uuid, title text, day date, project text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._bot_ok(p_key);
  if to_regclass('public.project_tasks') is not null then
    return query execute $q$
      select 'task'::text, t.id, t.title::text, t.due_date::date, (p.code || ' · ' || p.name)::text
      from public.project_tasks t left join public.projects p on p.id = t.project_id
      where t.due_date is not null and coalesce(t.status::text, '') <> 'completed'
        and (p.id is null or p.deleted_at is null) $q$;
  end if;
  if to_regclass('public.milestones') is not null then
    return query execute $q$
      select 'milestone'::text, m.id, m.name::text, m.planned_date::date, (p.code || ' · ' || p.name)::text
      from public.milestones m left join public.projects p on p.id = m.project_id
      where m.planned_date is not null and coalesce(m.status::text, '') <> 'completed'
        and (p.id is null or p.deleted_at is null) $q$;
  end if;
end $$;
revoke all on function public.bot_calendar_items(text) from public;
grant execute on function public.bot_calendar_items(text) to anon, authenticated;
