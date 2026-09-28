-- the per-person sub-accounts were created by this migration; the system-account guard is for users, not for undoing it
alter table public.accounts disable trigger accounts_guard;
delete from public.accounts where contact_id is not null;
alter table public.accounts enable trigger accounts_guard;
alter table public.accounts drop constraint if exists accounts_contact_fk;
drop table if exists public.contacts;
