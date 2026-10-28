-- Back to 039: bank and cash less what is owed to members and lenders.
create or replace function public.company_capital_available()
returns table (contact_id uuid, name text, available numeric) language sql stable set search_path = public, pg_temp as $$
  with members as (
    select d.contact_id, c.name, d.balance available
    from public.director_accounts_v d join public.contacts c on c.id = d.contact_id
    where d.book = public.current_book() and d.balance > 0.005
  ), owed as (
    select coalesce(sum(j.home_credit - j.home_debit), 0) total
    from public.journal_lines j join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
    where j.book = public.current_book()
      and par.subtype in ('project_loans', 'capital_pool_loans', 'financing_return_payable', 'profit_share_payable', 'members_funds')
  ), committed as (
    select coalesce(sum(f.amount), 0) total
    from public.project_company_funding f join public.projects p on p.id = f.project_id
    where f.book = public.current_book() and not (p.completed_at is not null and abs(public.client_balance(p.id)) < 0.005)
  ), money as (
    select coalesce(sum(j.home_debit - j.home_credit), 0) total
    from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.book = public.current_book() and a.subtype in ('bank', 'cash', 'undeposited')
  )
  select x.contact_id, x.name, x.available from (
    select m.contact_id, m.name, m.available, 0 k from members m
    union all
    select null::uuid, 'Company', greatest(y.total - o.total - f.total, 0), 1 from money y, owed o, committed f
  ) x order by x.k, x.available desc, x.name
$$;
