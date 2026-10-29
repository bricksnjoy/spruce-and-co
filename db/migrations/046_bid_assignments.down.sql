drop function if exists public.bot_claim_run(text, date, text);
drop function if exists public.bot_assignments(text);
drop function if exists public.bot_assign(text, uuid, text, bigint, text);
drop function if exists public.bot_people(text, jsonb, bigint[]);
drop function if exists public._bot_ok(text);
drop table if exists public.bot_runs;
drop table if exists public.bid_assignments;
drop table if exists public.telegram_people;
