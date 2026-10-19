-- 016 · Contacts screens (Phase 4, module 2). Balances are derived, never stored:
-- what a customer owes is their Accounts Receivable lines, what we owe a vendor
-- their Accounts Payable lines; overdue is the unpaid part of documents past due.

create or replace view public.contact_balances_v with (security_invoker = on) as
select c.id as contact_id, c.book,
  coalesce((select sum(j.home_debit - j.home_credit) from public.journal_lines j
            where j.contact_id = c.id and j.account_id = public.acct('ar')), 0) as receivable,
  coalesce((select sum(j.home_credit - j.home_debit) from public.journal_lines j
            where j.contact_id = c.id and j.account_id = public.acct('ap')), 0) as payable,
  coalesce((select sum(b.balance) from public.document_balances_v b
            where b.contact_id = c.id and b.type = 'invoice' and not b.is_draft and b.voided_at is null
              and b.balance > 0 and b.due_date < public.today_mv()), 0) as overdue_receivable,
  coalesce((select sum(b.balance) from public.document_balances_v b
            where b.contact_id = c.id and b.type = 'bill' and not b.is_draft and b.voided_at is null
              and b.balance > 0 and b.due_date < public.today_mv()), 0) as overdue_payable,
  (select count(*) from public.transactions t where t.contact_id = c.id and t.voided_at is null) as documents
from public.contacts c;

/**
 * A contact's statement: every posting to their receivable (or payable)
 * between two dates, one line per document, with the balance brought forward
 * and a running balance. Customer amounts are what they owe; vendor amounts
 * what we owe them.
 */
create or replace function public.contact_statement(p_contact uuid, p_side text, p_from date, p_to date)
returns table (line_date date, transaction_id uuid, type public.txn_type, number text, memo text, due_date date, amount numeric, balance numeric)
language plpgsql stable set search_path = public, pg_temp as $$
declare acc uuid; s int; opening numeric;
begin
  if p_side not in ('customer', 'vendor') then raise exception 'A statement is for a customer or a vendor'; end if;
  acc := public.acct(case when p_side = 'customer' then 'ar' else 'ap' end);
  s := case when p_side = 'customer' then 1 else -1 end;
  select coalesce(sum(s * (j.home_debit - j.home_credit)), 0) into opening
    from public.journal_lines j where j.contact_id = p_contact and j.account_id = acc and j.date < p_from;
  line_date := p_from; transaction_id := null; type := null; number := null; memo := 'Balance brought forward';
  due_date := null; amount := null; balance := opening;
  return next;
  return query
  select x.date, x.transaction_id, t.type, t.number, t.memo, t.due_date, x.amt,
    opening + sum(x.amt) over (order by x.date, t.created_at, x.transaction_id)
  from (select j.date, j.transaction_id, sum(s * (j.home_debit - j.home_credit)) amt
        from public.journal_lines j
        where j.contact_id = p_contact and j.account_id = acc and j.date between p_from and p_to
        group by j.date, j.transaction_id) x
  join public.transactions t on t.id = x.transaction_id
  where x.amt <> 0
  order by x.date, t.created_at, x.transaction_id;
end $$;

revoke all on public.contact_balances_v from anon;
revoke execute on function public.contact_statement(uuid, text, date, date) from public, anon;
grant execute on function public.contact_statement(uuid, text, date, date) to authenticated;
