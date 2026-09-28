-- 003 · Contacts: customers, vendors, lenders and partners in one list.
-- Existing clients, vendors, investors and capital-pool members are copied in;
-- the old tables are not changed. Rows you have not confirmed as real are
-- marked needs_review (decision R1).

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  kinds text[] not null default '{}' check (kinds <@ array['customer', 'vendor', 'lender', 'partner']::text[]),
  name text not null,
  company_name text,
  contact_person text,
  email text,
  phone text,
  address text,
  tin text,
  gst_registered boolean not null default false,
  taxable_activity_no text,
  bank_details text,
  terms_days int check (terms_days >= 0),
  currency char(3) not null default 'MVR' references public.currencies,
  vendor_kind text,
  trade text,
  licence_expiry date,
  insurance_expiry date,
  notes text,
  needs_review boolean not null default false,
  active boolean not null default true,
  legacy jsonb not null default '{}',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_kinds on public.contacts using gin (kinds);
create index contacts_name on public.contacts (lower(name));
alter table public.accounts add constraint accounts_contact_fk foreign key (contact_id) references public.contacts;

insert into public.contacts (kinds, name, contact_person, email, phone, address, tin, notes, needs_review, active, legacy)
select array['customer'], name, contact_name, email, phone, address, tax_number, notes, true, is_active, jsonb_build_object('client_id', id)
from public.clients;

insert into public.contacts (kinds, name, contact_person, email, phone, address, tin, bank_details, vendor_kind, trade,
  licence_expiry, insurance_expiry, notes, needs_review, legacy)
select array['vendor'], name, contact_name, email, phone, address, coalesce(tin, tax_number), bank_details, kind::text, trade,
  licence_expiry, insurance_expiry, notes, true, jsonb_build_object('vendor_id', id)
from public.vendors;

-- decision A6: the investors are external lenders
insert into public.contacts (kinds, name, contact_person, email, phone, address, tin, bank_details, notes, needs_review, legacy)
select array['lender'], name, contact_name, email, phone, address, tax_number, bank_details, notes, true, jsonb_build_object('investor_id', id)
from public.investors;

-- the capital-pool members are real (R1); the company itself is not a contact
insert into public.contacts (kinds, name, legacy)
select array['partner'], name, jsonb_build_object('pool_member_id', id)
from public.capital_pool_members where kind = 'person';

-- each partner's own Capital Pool Loan and Profit Share Payable sub-account (§2)
select public.sub_account('capital_pool_loans', id), public.sub_account('profit_share_payable', id)
from public.contacts where 'partner' = any (kinds) order by name;

create trigger contacts_audit after insert or update or delete on public.contacts for each row execute function public.log_change();
