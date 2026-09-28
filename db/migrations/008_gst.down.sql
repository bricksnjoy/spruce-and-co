drop view if exists public.gst_periods_v;
drop function if exists public.pay_gst_period(uuid, uuid, date, numeric);
drop function if exists public.file_gst_period(uuid, text);
drop function if exists public.gst_payable(uuid);
drop function if exists public.gst_totals(uuid);
drop trigger if exists journal_lines_filed_gst on public.journal_lines;
drop function if exists public.guard_filed_gst();
update public.journal_lines set tax_period_id = null where tax_period_id is not null;
alter table public.transactions drop constraint if exists transactions_tax_period_fk;
alter table public.journal_lines drop constraint if exists journal_lines_tax_period_fk;
drop function if exists public.gst_period_for(date);
drop table if exists public.tax_periods;
-- the ledger's hooks go back to doing nothing
create or replace function public._line_frozen(p_period uuid) returns boolean language sql stable as $$ select false $$;
create or replace function public._gst_after_post(p_id uuid) returns void language plpgsql as $$ begin end $$;
