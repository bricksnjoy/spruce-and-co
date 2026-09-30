drop trigger if exists journal_lines_advance_balance on public.journal_lines;
drop function if exists public.check_advance_balance();
drop function if exists public.customer_advance_balance(uuid);
