drop function if exists public.bot_set_bid_status(text, uuid, text, text);
drop function if exists public.bot_put_setting(text, text, text);
drop table if exists public.bot_settings;
update public.bid_events set status = 'registered' where status = 'posted';
update public.bids set status = 'registered' where status = 'posted';
alter table public.bid_events drop constraint if exists bid_events_status_check;
alter table public.bid_events add constraint bid_events_status_check
  check (status in ('registered', 'prebid_meeting', 'papers_ready', 'submitted', 'won', 'lost'));
alter table public.bids drop constraint if exists bids_status_check;
alter table public.bids add constraint bids_status_check
  check (status in ('registered', 'prebid_meeting', 'papers_ready', 'submitted', 'won', 'lost'));
