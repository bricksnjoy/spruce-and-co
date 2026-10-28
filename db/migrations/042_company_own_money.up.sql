/**
 * What can finance a project from the Capital Pool, in the current book: each
 * member's director's account, and the company's own money. A project's money
 * stays in the project until it is completed and paid for (then its profit is
 * split and the company's part is its own): so the company's own money is bank,
 * cash and payments not yet banked, less everything it owes (members, lenders,
 * GST, vendors, salaries …), less what projects not yet completed and paid for
 * hold (their income less their costs, less what their clients still owe), and
 * less what the company has put into those projects.
 */
create or replace function public.company_capital_available()
returns table (contact_id uuid, name text, available numeric) language sql stable set search_path = public, pg_temp as $$
  with members as (
    select d.contact_id, c.name, d.balance available
    from public.director_accounts_v d join public.contacts c on c.id = d.contact_id
    where d.book = public.current_book() and d.balance > 0.005
  ), running as (
    select p.id from public.projects p
    where p.book = public.current_book() and not (p.completed_at is not null and abs(public.client_balance(p.id)) < 0.005)
  ), committed as (
    select coalesce(sum(f.amount), 0) total
    from public.project_company_funding f where f.book = public.current_book() and f.project_id in (select id from running)
  ), books as (
    select
      -- money, and GST to be claimed back against what is owed
      coalesce(sum(j.home_debit - j.home_credit) filter (where a.subtype in ('bank', 'cash', 'undeposited', 'gst_input', 'gst_refund')), 0) money,
      coalesce(sum(j.home_credit - j.home_debit) filter (where a.type = 'liability'), 0) owed,
      coalesce(sum(case
        when a.type = 'income' then j.home_credit - j.home_debit
        when a.type in ('cogs', 'expense') or a.subtype in ('ar', 'retention_receivable', 'contract_asset') then j.home_credit - j.home_debit
        else 0 end) filter (where j.project_id in (select id from running)), 0) held
    from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.book = public.current_book()
  )
  select x.contact_id, x.name, x.available from (
    select m.contact_id, m.name, m.available, 0 k from members m
    union all
    select null::uuid, 'Company', greatest(b.money - b.owed - b.held - f.total, 0), 1 from books b, committed f
  ) x order by x.k, x.available desc, x.name
$$;
