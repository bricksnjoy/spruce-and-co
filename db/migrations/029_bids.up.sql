-- Bids: tenders the company is chasing, from registering for one to winning or
-- losing it. Not part of the books: no book column, so like quotations and
-- tasks they live in the Live book only. Each status change and note is kept
-- in bid_events, so a bid shows its own history.
create table public.bids (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  -- who put the work out to tender
  company text,
  gazette_url text check (gazette_url is null or gazette_url ~* '^https?://'),
  status text not null default 'registered'
    check (status in ('registered', 'prebid_meeting', 'papers_ready', 'submitted', 'won', 'lost')),
  prebid_meeting_at timestamptz,
  prebid_attendance text check (prebid_attendance in ('optional', 'compulsory')),
  submission_due_at timestamptz,
  notes text,
  -- the project it became, once won
  project_id uuid references public.projects on delete set null,
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bids_status on public.bids (status);

create table public.bid_events (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids on delete cascade,
  -- a status change, or a note
  status text check (status in ('registered', 'prebid_meeting', 'papers_ready', 'submitted', 'won', 'lost')),
  note text,
  check (status is not null or note is not null),
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index bid_events_bid on public.bid_events (bid_id, created_at);

alter table public.bids enable row level security;
alter table public.bid_events enable row level security;
-- everyone on the staff sees them; admin, manager and finance change them
create policy bids_read on public.bids for select to authenticated using (public.is_staff());
create policy bids_write on public.bids for all to authenticated using (public.can_write()) with check (public.can_write());
create policy bid_events_read on public.bid_events for select to authenticated using (public.is_staff());
create policy bid_events_add on public.bid_events for insert to authenticated with check (public.can_write());
revoke all on public.bids, public.bid_events from anon;
grant select, insert, update, delete on public.bids to authenticated;
grant select, insert on public.bid_events to authenticated;
