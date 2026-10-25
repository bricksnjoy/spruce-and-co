-- Back to bank and cash only, as 030 had it.
/**
 * What can finance a project from the Capital Pool, in the current book: what
 * each member is owed and could be paid today (principal, financing return and
 * profit share on projects completed and paid in full by the client), and the
 * company's own money — bank and cash, less what those members are owed.
 */
create or replace function public.company_capital_available()
returns table (contact_id uuid, name text, available numeric) language sql stable set search_path = public, pg_temp as $$
  with directors as (
    select j.contact_id, c.name, sum(j.home_credit - j.home_debit) available
    from public.journal_lines j
    join public.accounts a on a.id = j.account_id
    join public.accounts par on par.id = a.parent_id
    join public.contacts c on c.id = j.contact_id
    join public.projects p on p.id = j.project_id
    where j.book = public.current_book() and par.subtype in ('capital_pool_loans', 'financing_return_payable', 'profit_share_payable')
      and 'partner' = any (c.kinds) and p.completed_at is not null and abs(public.client_balance(p.id)) < 0.005
    group by j.contact_id, c.name
    having sum(j.home_credit - j.home_debit) > 0
  ), money as (
    select coalesce(sum(j.home_debit - j.home_credit), 0) total
    from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.book = public.current_book() and a.subtype in ('bank', 'cash')
  )
  select x.contact_id, x.name, x.available from (
    select d.contact_id, d.name, d.available, 0 k from directors d
    union all
    select null::uuid, 'Company', greatest(m.total - coalesce((select sum(available) from directors), 0), 0), 1 from money m
  ) x order by x.k, x.available desc, x.name
$$;
