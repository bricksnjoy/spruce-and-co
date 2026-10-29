drop function if exists public.bot_bids(text);
/** Every bid with its stage, place and dates, for the bot; refused without the right key. */
create function public.bot_bids(p_key text)
returns table (id uuid, name text, company text, location text, gazette_url text, status text,
  prebid_meeting_at timestamptz, prebid_attendance text, submission_due_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or length(p_key) < 32 or not exists (
    select 1 from public.bot_keys k where k.name = 'telegram' and k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'Not allowed';
  end if;
  return query
    select b.id, b.name, b.company, b.location, b.gazette_url, b.status, b.prebid_meeting_at, b.prebid_attendance, b.submission_due_at
    from public.bids b order by b.submission_due_at nulls last, b.name;
end $$;
revoke all on function public.bot_bids(text) from public;
grant execute on function public.bot_bids(text) to anon, authenticated;
alter table public.bids drop column if exists papers_due_on;
