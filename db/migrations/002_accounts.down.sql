drop table if exists public.accounts;
drop function if exists public.guard_account();
drop function if exists public.sub_account(text, uuid);
drop function if exists public.acct(text);
drop type if exists public.account_type;
