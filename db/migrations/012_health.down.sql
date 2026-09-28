drop function if exists public.health_check(text);
drop trigger if exists settings_closing_stamp on public.settings;
drop function if exists public.stamp_closing_date();
alter table public.journal_lines drop column if exists created_at;
