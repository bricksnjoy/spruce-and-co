delete from public.accounts where contact_id is not null;
alter table public.accounts drop constraint if exists accounts_contact_fk;
drop table if exists public.contacts;
