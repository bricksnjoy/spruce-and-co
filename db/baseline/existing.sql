-- The parts of the live schema (28 Sep 2026) that the new migrations build on.
-- Used by the test suite only, to stand up a local Postgres (PGlite) that looks
-- like production before db/migrations run. Never applied to Supabase.

-- Supabase auth, reduced to what the functions need
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;

create type user_role as enum ('admin','manager','finance','viewer');
create type party_type as enum ('individual','company');
create type vendor_kind as enum ('subcontractor','supplier','consultant','other');
create type investor_status as enum ('prospect','kyc_pending','active','inactive');
create type share_kind as enum ('investors','company','person');
create type person_role as enum ('director','shareholder','employee','other');
create type project_status as enum ('lead','tendering','won','in_progress','on_hold','completed','cancelled');
create type variation_status as enum ('draft','submitted','approved','rejected','cancelled');

create table public.company (
  id boolean not null default true primary key,
  legal_name text not null,
  trade_name text,
  registration_no text,
  uei text,
  tin text,
  gst_registered boolean not null default false,
  taxable_activity_no text,
  address text,
  phone text,
  email text,
  bank_details text,
  updated_at timestamp with time zone not null default now(),
  stamp_path text,
  share_capital numeric not null default 0,
  share_capital_date date,
  bpt_rate numeric not null default 15,
  bpt_threshold numeric not null default 500000,
  asset_life_years numeric not null default 5,
  opening_cash numeric not null default 0
);

create table public.profiles (
  id uuid not null primary key,
  full_name text not null default ''::text,
  email text not null default ''::text,
  role user_role not null default 'viewer'::user_role,
  phone text,
  job_title text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.clients (
  id uuid not null default gen_random_uuid() primary key,
  name text not null,
  type party_type not null default 'company'::party_type,
  contact_name text,
  email text,
  phone text,
  address text,
  city text,
  country text,
  tax_number text,
  notes text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.vendors (
  id uuid not null default gen_random_uuid() primary key,
  name text not null,
  kind vendor_kind not null default 'subcontractor'::vendor_kind,
  trade text,
  contact_name text,
  email text,
  phone text,
  address text,
  tax_number text,
  bank_details text,
  rating integer,
  insurance_expiry date,
  licence_expiry date,
  is_approved boolean not null default false,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  tin text
);

create table public.investors (
  id uuid not null default gen_random_uuid() primary key,
  name text not null,
  type party_type not null default 'individual'::party_type,
  status investor_status not null default 'prospect'::investor_status,
  contact_name text,
  email text,
  phone text,
  address text,
  city text,
  country text,
  tax_number text,
  bank_details text,
  kyc_verified_at date,
  source text,
  notes text,
  relationship_owner_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.capital_pool_members (
  id uuid not null default gen_random_uuid() primary key,
  name text not null unique,
  kind share_kind not null default 'person'::share_kind,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now()
);

create table public.people (
  id uuid not null default gen_random_uuid() primary key,
  name text not null,
  role person_role not null default 'employee'::person_role,
  title text,
  phone text,
  email text,
  pool_member_id uuid,
  active boolean not null default true,
  joined_on date,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.profit_shares (
  id uuid not null default gen_random_uuid() primary key,
  name text not null,
  kind share_kind not null default 'person'::share_kind,
  pct numeric(6,3) not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  note text,
  updated_at timestamp with time zone not null default now()
);

create table public.cost_categories (
  id uuid not null default gen_random_uuid() primary key,
  name text not null unique,
  sort_order integer not null default 0
);

create table public.projects (
  id uuid not null default gen_random_uuid() primary key,
  code text not null unique,
  name text not null,
  client_id uuid,
  status project_status not null default 'lead'::project_status,
  description text,
  site_address text,
  city text,
  contract_value numeric(14,2) not null default 0,
  budget_amount numeric(14,2) not null default 0,
  funding_target numeric(14,2) not null default 0,
  start_date date,
  end_date date,
  actual_end_date date,
  progress_pct numeric(5,2) not null default 0,
  project_manager_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  gst_amount numeric(14,2) not null default 0,
  duration_days integer,
  completed_at timestamp with time zone,
  payment_received_at timestamp with time zone,
  payment_received_amount numeric(14,2),
  financing_repay_pct numeric(6,3) not null default 0,
  archived_at timestamp with time zone
);

create table public.variations (
  id uuid not null default gen_random_uuid() primary key,
  project_id uuid not null references public.projects on delete cascade,
  ref text not null,
  title text not null,
  description text,
  status variation_status not null default 'draft'::variation_status,
  cost_impact numeric(14,2) not null default 0,
  time_impact_days integer not null default 0,
  raised_date date not null default CURRENT_DATE,
  approved_date date,
  approved_by uuid,
  client_reference text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.budget_lines (
  id uuid not null default gen_random_uuid() primary key,
  project_id uuid not null references public.projects on delete cascade,
  category_id uuid references public.cost_categories,
  description text not null,
  budget_amount numeric(14,2) not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.signatories (
  id uuid not null default gen_random_uuid() primary key,
  person_id uuid,
  name text not null,
  title text,
  signature_path text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table public.audit_log (
  id bigint generated by default as identity primary key,
  at timestamp with time zone not null default now(),
  user_id uuid default auth.uid(),
  table_name text not null,
  record_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed text[]
);

-- the live role helpers (security definer, as in production)
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active) $$;
create or replace function public.can_write() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active and role in ('admin','manager','finance')) $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active and role = 'admin') $$;
create or replace function public.can_see_payroll() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active and role in ('admin','finance')) $$;

-- the live project-code suggestion, unchanged
create or replace function public.next_project_code() returns text language sql stable set search_path = public, pg_temp as $$
  select 'SC-' || lpad(
    (coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::int), 0) + 1)::text,
    3, '0')
  from projects
  where code ~ '^SC-\d+$'
$$;

-- the live change-log trigger function, unchanged
create or replace function public.log_change() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb; n jsonb; ch text[];
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    select array_agg(k) into ch from jsonb_object_keys(n) k
      where k not in ('updated_at') and n -> k is distinct from o -> k;
    if ch is null then return new; end if;
  end if;
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed)
  values (tg_table_name, coalesce(n ->> 'id', o ->> 'id'), lower(tg_op), o, n, ch);
  return coalesce(new, old);
end $$;

-- reference rows shaped like production's
insert into public.company (legal_name, gst_registered) values ('Spruce & Co Private Limited', true);
insert into public.capital_pool_members (name, kind, sort_order) values
  ('Spruce & Co', 'company', 0), ('Mujahid', 'person', 1), ('Muaz', 'person', 2), ('Mushahid', 'person', 3), ('Mariyam Zahir', 'person', 4);
insert into public.profit_shares (name, kind, pct, sort_order) values
  ('Investors', 'investors', 20, 1), ('Spruce & Co (retained)', 'company', 30, 2), ('Mujahid (Managing Director)', 'person', 25, 3),
  ('Muaz', 'person', 10, 4), ('Mushahid', 'person', 10, 5), ('Mariyam Zahir', 'person', 5, 6);
insert into public.cost_categories (name, sort_order) select n, o from unnest(array[
  'Preliminaries','Groundworks & Substructure','Structure & Frame','Roofing','External Envelope','Internal Finishes',
  'Mechanical & Electrical','Joinery','Plant & Equipment Hire','Materials','Labour & Subcontract','Professional Fees',
  'Site Overheads','Transport & Logistics','Contingency']) with ordinality as t(n, o);
insert into public.clients (name) values ('Sample Client A');
insert into public.vendors (name, kind, tin) values ('Sample Supplier', 'supplier', '1000001GST501');
insert into public.investors (name) values ('Sample Lender');
insert into public.people (name, role, pool_member_id) select 'Mujahid', 'director', id from public.capital_pool_members where name = 'Mujahid';

-- Supabase's API roles, with its default grants on everything in public
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant execute on all functions in schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
alter table public.projects enable row level security;
create policy projects_read on public.projects for select using (public.is_staff());
create policy projects_ins on public.projects for insert with check (public.can_write());
create policy projects_upd on public.projects for update using (public.can_write());
create policy projects_del on public.projects for delete using (public.is_admin());
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select using (public.is_staff());
