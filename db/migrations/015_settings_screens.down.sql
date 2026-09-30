drop trigger if exists rates_guard on public.rates;
drop function if exists public.guard_rate();
drop function if exists public.rpc_set_numbering(text, text, int, int);
drop function if exists public.rpc_account_balances(date, date);
