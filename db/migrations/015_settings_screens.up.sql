-- 015 · What the Settings and Chart of Accounts screens need (Phase 4, module 1).
-- • Account balances for the book you are in, from the ledger. They run with
--   full sight so totals include payroll lines a user may not see line by line.
-- • Numbering can be changed by an admin, never onto a number already used.
-- • A rate that is already in force is never changed or removed: a new rate
--   is added from a later date. Brackets are checked for gaps and overlaps.

create or replace function public.rpc_account_balances(p_from date default null, p_to date default null)
returns table (account_id uuid, debit numeric, credit numeric, balance numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('staff');
  return query
  select j.account_id, sum(j.home_debit), sum(j.home_credit),
    case when a.type in ('asset', 'cogs', 'expense') then sum(j.home_debit - j.home_credit) else sum(j.home_credit - j.home_debit) end
  from public.journal_lines j join public.accounts a on a.id = j.account_id
  where j.book = public.current_book() and (p_from is null or j.date >= p_from) and (p_to is null or j.date <= p_to)
  group by j.account_id, a.type;
end $$;

create or replace function public.rpc_set_numbering(p_type text, p_prefix text, p_next int, p_pad int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_candidate text;
begin
  perform public.require_role('admin');
  if coalesce(trim(p_prefix), '') = '' then raise exception 'Enter a prefix'; end if;
  if p_next is null or p_next < 1 then raise exception 'The next number must be 1 or more'; end if;
  if p_pad is null or p_pad not between 1 and 8 then raise exception 'Digits must be between 1 and 8'; end if;
  if public.current_book() = 'sandbox' and p_prefix not like 'TEST-%' then
    raise exception 'Test-book numbers must start with TEST- so they can never be mistaken for real ones';
  end if;
  v_candidate := replace(p_prefix, '{YY}', to_char(public.today_mv(), 'YY')) || lpad(p_next::text, p_pad, '0');
  if exists (select 1 from public.transactions where book = public.current_book() and type::text = p_type and number = v_candidate) then
    raise exception '% is already used; choose a higher next number', v_candidate;
  end if;
  update public.document_sequences set prefix = p_prefix, next_number = p_next, pad = p_pad
    where book = public.current_book() and type = p_type;
  if not found then raise exception 'No numbering for %', p_type; end if;
end $$;

create or replace function public.guard_rate() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare b jsonb; prev numeric := 0; i int := 0; n int;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.effective_from <= public.today_mv() then
    raise exception 'That rate is already in force and cannot change. Add a new rate from a later date instead.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.value is not null and new.value not between 0 and 100 then raise exception 'A rate is a percentage between 0 and 100'; end if;
  if new.brackets is not null then
    if jsonb_typeof(new.brackets) <> 'array' or jsonb_array_length(new.brackets) = 0 then raise exception 'Enter at least one bracket'; end if;
    n := jsonb_array_length(new.brackets);
    for b in select value from jsonb_array_elements(new.brackets) loop
      i := i + 1;
      if (b ->> 'from')::numeric <> prev then raise exception 'Bracket % must start where the one before it ends (%)', i, prev; end if;
      if (b ->> 'rate')::numeric not between 0 and 100 then raise exception 'Bracket % rate must be between 0 and 100', i; end if;
      if i < n and (b ->> 'to') is null then raise exception 'Only the last bracket can be open-ended'; end if;
      if i = n and (b ->> 'to') is not null then raise exception 'The last bracket must be open-ended'; end if;
      if (b ->> 'to') is not null and (b ->> 'to')::numeric <= prev then raise exception 'Bracket % must end above where it starts', i; end if;
      prev := (b ->> 'to')::numeric;
    end loop;
  end if;
  return new;
end $$;
create trigger rates_guard before insert or update or delete on public.rates for each row execute function public.guard_rate();

revoke execute on function public.rpc_account_balances(date, date) from public, anon;
revoke execute on function public.rpc_set_numbering(text, text, int, int) from public, anon;
grant execute on function public.rpc_account_balances(date, date) to authenticated;
grant execute on function public.rpc_set_numbering(text, text, int, int) to authenticated;
