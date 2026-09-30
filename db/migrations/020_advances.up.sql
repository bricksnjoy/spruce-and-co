-- 020 · Client advances (decision B2): what is held for a customer, and a rule
-- that no more of an advance is ever used than was received.

create or replace function public.customer_advance_balance(p_contact uuid) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(home_credit - home_debit), 0) from public.journal_lines
  where contact_id = p_contact and account_id = public.acct('customer_advances')
$$;

create or replace function public.check_advance_balance() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v numeric;
begin
  if new.account_id <> public.acct('customer_advances') or new.contact_id is null then return null; end if;
  select coalesce(sum(home_credit - home_debit), 0) into v from public.journal_lines
    where contact_id = new.contact_id and account_id = new.account_id and book = new.book;
  if v < 0 then
    raise exception 'That uses more advance than % has paid (short by %)', (select name from public.contacts where id = new.contact_id), -v
      using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger journal_lines_advance_balance after insert or update on public.journal_lines
  deferrable initially deferred for each row execute function public.check_advance_balance();

revoke execute on function public.check_advance_balance() from public, anon, authenticated;
revoke execute on function public.customer_advance_balance(uuid) from public, anon;
grant execute on function public.customer_advance_balance(uuid) to authenticated;
