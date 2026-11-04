-- 055 · Bids: a first stage "posted" (the tender is out, not registered for
-- yet); the Telegram topic a submitted bid's summary goes to (set by sending
-- /bidsummary in that topic); and Won / Lost pressed under that summary moves
-- the bid on the site.

alter table public.bids drop constraint if exists bids_status_check;
alter table public.bids add constraint bids_status_check
  check (status in ('posted', 'registered', 'prebid_meeting', 'papers_ready', 'submitted', 'won', 'lost'));
alter table public.bid_events drop constraint if exists bid_events_status_check;
alter table public.bid_events add constraint bid_events_status_check
  check (status in ('posted', 'registered', 'prebid_meeting', 'papers_ready', 'submitted', 'won', 'lost'));

-- the bot's settings: what it has been told in the group
create table public.bot_settings (
  name text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.bot_settings enable row level security;
create policy bot_settings_read on public.bot_settings for select to authenticated using (public.is_staff());
revoke all on public.bot_settings from anon, authenticated;
grant select on public.bot_settings to authenticated;

/** Keep one of the bot's settings (the bot only). */
create or replace function public.bot_put_setting(p_key text, p_name text, p_value text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._bot_ok(p_key);
  insert into public.bot_settings (name, value) values (p_name, p_value)
  on conflict (name) do update set value = excluded.value, updated_at = now();
end $$;

/** Won or lost, pressed in the group (the bot only): the bid moves, with who pressed it in its history. */
create or replace function public.bot_set_bid_status(p_key text, p_bid uuid, p_status text, p_by text)
returns table (name text, status text) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._bot_ok(p_key);
  if p_status not in ('won', 'lost', 'submitted') then raise exception 'Only won, lost or submitted'; end if;
  update public.bids b set status = p_status, updated_at = now() where b.id = p_bid;
  if not found then raise exception 'That bid no longer exists'; end if;
  insert into public.bid_events (bid_id, status, note) values (p_bid, p_status, 'From Telegram' || coalesce(', by ' || nullif(trim(p_by), ''), ''));
  return query select b.name, b.status from public.bids b where b.id = p_bid;
end $$;

revoke all on function public.bot_put_setting(text, text, text), public.bot_set_bid_status(text, uuid, text, text) from public;
grant execute on function public.bot_put_setting(text, text, text), public.bot_set_bid_status(text, uuid, text, text) to anon, authenticated;

-- the group's "bid summary" topic (t.me/c/3905451459/37); /bidsummary in another topic moves it
insert into public.bot_settings (name, value) values ('summary_topic', '37') on conflict (name) do nothing;
