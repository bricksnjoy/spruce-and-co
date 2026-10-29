-- Who goes to a bid's pre-bid meeting and who hands in its papers, picked from
-- the names in the Telegram group; the people the bot has seen there (Telegram
-- does not let a bot list a group's members); and which evening reminders have
-- gone, so each goes once a day.
create table public.telegram_people (
  user_id bigint primary key,
  name text not null check (length(trim(name)) > 0),
  username text,
  seen_at timestamptz not null default now()
);
create table public.bid_assignments (
  bid_id uuid not null references public.bids on delete cascade,
  task text not null check (task in ('prebid', 'submit')),
  user_id bigint not null,
  name text not null,
  assigned_at timestamptz not null default now(),
  primary key (bid_id, task, user_id)
);
create table public.bot_runs (
  day date not null,
  step text not null,
  at timestamptz not null default now(),
  primary key (day, step)
);
alter table public.telegram_people enable row level security;
alter table public.bid_assignments enable row level security;
alter table public.bot_runs enable row level security;
-- the staff see who is going on the bid's page; only the bot changes these
create policy bid_assignments_read on public.bid_assignments for select to authenticated using (public.is_staff());
revoke all on public.telegram_people, public.bot_runs, public.bid_assignments from anon, authenticated;
grant select on public.bid_assignments to authenticated;

/** Refuse unless p_key is the bot's key (its sha-256 is in bot_keys). */
create or replace function public._bot_ok(p_key text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or length(p_key) < 32 or not exists (
    select 1 from public.bot_keys k where k.name = 'telegram' and k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'Not allowed';
  end if;
end $$;
revoke all on function public._bot_ok(text) from public;

/**
 * The people the bot knows in the group: those seen ([{id, name, username}]) are
 * added or renamed, those who left are dropped, and everyone is returned.
 */
create or replace function public.bot_people(p_key text, p_seen jsonb default '[]', p_left bigint[] default '{}')
returns table (user_id bigint, name text, username text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._bot_ok(p_key);
  insert into public.telegram_people (user_id, name, username, seen_at)
    select (x ->> 'id')::bigint, trim(x ->> 'name'), nullif(x ->> 'username', ''), now()
    from jsonb_array_elements(coalesce(p_seen, '[]')) x
    where (x ->> 'id') ~ '^\d+$' and length(trim(coalesce(x ->> 'name', ''))) > 0
  on conflict on constraint telegram_people_pkey do update set name = excluded.name, username = excluded.username, seen_at = now();
  delete from public.telegram_people t where t.user_id = any (coalesce(p_left, '{}'));
  return query select t.user_id, t.name, t.username from public.telegram_people t order by t.name;
end $$;

/** Put a person on a bid's pre-bid meeting or submission, or take them off; who is on it now. */
create or replace function public.bot_assign(p_key text, p_bid uuid, p_task text, p_user bigint, p_name text)
returns table (user_id bigint, name text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._bot_ok(p_key);
  if p_task not in ('prebid', 'submit') then raise exception 'Unknown task'; end if;
  if not exists (select 1 from public.bids b where b.id = p_bid) then raise exception 'No such bid'; end if;
  if exists (select 1 from public.bid_assignments a where a.bid_id = p_bid and a.task = p_task and a.user_id = p_user) then
    delete from public.bid_assignments a where a.bid_id = p_bid and a.task = p_task and a.user_id = p_user;
  else
    insert into public.bid_assignments (bid_id, task, user_id, name) values (p_bid, p_task, p_user, trim(p_name));
  end if;
  return query select a.user_id, a.name from public.bid_assignments a where a.bid_id = p_bid and a.task = p_task order by a.assigned_at;
end $$;

/** Everyone put on a bid, for the reminders. */
create or replace function public.bot_assignments(p_key text)
returns table (bid_id uuid, task text, user_id bigint, name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._bot_ok(p_key);
  return query select a.bid_id, a.task, a.user_id, a.name from public.bid_assignments a order by a.assigned_at;
end $$;

/** Take a day's turn for an evening reminder: true the first time, false after. */
create or replace function public.bot_claim_run(p_key text, p_day date, p_step text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._bot_ok(p_key);
  insert into public.bot_runs (day, step) values (p_day, p_step) on conflict do nothing;
  return found;
end $$;

revoke all on function public.bot_people(text, jsonb, bigint[]), public.bot_assign(text, uuid, text, bigint, text),
  public.bot_assignments(text), public.bot_claim_run(text, date, text) from public;
grant execute on function public.bot_people(text, jsonb, bigint[]), public.bot_assign(text, uuid, text, bigint, text),
  public.bot_assignments(text), public.bot_claim_run(text, date, text) to anon, authenticated;
