-- 053 · A project can be completed before its loans are repaid; the loans are
-- repaid first from the money, before any profit leaves.
-- Completing (and posting the split) now waits only for the client to pay and
-- for the project's bills to be paid; expenses are paid when recorded, so they
-- never hold it (050 counted an expense's total as still to pay). Financing
-- returns and profit shares are paid out only once every loan to the project
-- (lenders and the Capital Pool) is repaid; principal can still be repaid as
-- soon as the client has paid, and in the same payout as the profit.

/** Why a project cannot be completed yet, or null when it can. */
create or replace function public.profit_hold(p_project uuid) returns text language sql stable set search_path = public, pg_temp as $$
  with unpaid as (
    select coalesce(sum(d.balance), 0) v from public.document_balances_v d
    where d.type = 'bill' and d.voided_at is null and not d.is_draft and d.balance > 0.005
      and (d.project_id = p_project or exists (select 1 from public.transaction_lines l where l.transaction_id = d.id and l.project_id = p_project))
  )
  select nullif(concat_ws('; ',
    case when abs(public.client_balance(p_project)) >= 0.005 then 'the client still owes MVR ' || to_char(public.client_balance(p_project), 'FM999,999,999,990.00') end,
    case when u.v > 0.005 then 'bills of MVR ' || to_char(u.v, 'FM999,999,999,990.00') || ' are still to pay' end), '')
  from unpaid u
$$;

/** Loans to a project not repaid yet (lenders and the Capital Pool), leaving out one transaction. */
create or replace function public.project_loans_owed(p_project uuid, p_exclude uuid default null) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(j.home_credit - j.home_debit), 0)
  from public.journal_lines j join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
  where par.subtype in ('project_loans', 'capital_pool_loans') and j.project_id = p_project
    and j.transaction_id is distinct from p_exclude
$$;

create or replace function public._payout_gate(t public.transactions) returns void language plpgsql set search_path = public, pg_temp as $$
declare r record; cb numeric; owed numeric; v_acct uuid; v_loans numeric;
begin
  for r in select coalesce(l.project_id, t.project_id) pid, coalesce(l.contact_id, t.contact_id) cid, l.component, sum(l.amount) amt
           from public.transaction_lines l where l.transaction_id = t.id group by 1, 2, 3 loop
    -- loans can be repaid once the client has paid, before completion; profit only after it
    if r.component <> 'principal' and not exists (select 1 from public.projects where id = r.pid and completed_at is not null) then
      raise exception 'Profit is paid once the project is completed' using errcode = 'P0001';
    end if;
    cb := public.client_balance(r.pid);
    if abs(cb) >= 0.005 then
      raise exception 'Payout blocked: the client still owes MVR % on %', to_char(cb, 'FM999,999,999,990.00'),
        (select code from public.projects where id = r.pid) using errcode = 'P0001';
    end if;
    -- loans are repaid first: no return or profit leaves while a loan to the project is owed
    -- (principal repaid in this same payout counts as repaid)
    if r.component <> 'principal' then
      v_loans := public.project_loans_owed(r.pid, t.id) - coalesce((select sum(l.amount) from public.transaction_lines l
        where l.transaction_id = t.id and l.component = 'principal' and coalesce(l.project_id, t.project_id) = r.pid), 0);
      if v_loans > 0.005 then
        raise exception 'Repay the loans first: MVR % lent to % is still to repay', to_char(v_loans, 'FM999,999,999,990.00'),
          (select code from public.projects where id = r.pid) using errcode = 'P0001';
      end if;
    end if;
    v_acct := case r.component
      when 'principal' then public._principal_account(r.cid, r.pid, t.id)
      when 'financing_return' then public.sub_account('financing_return_payable', r.cid)
      else public.sub_account('profit_share_payable', r.cid) end;
    select coalesce(sum(home_credit - home_debit), 0) into owed from public.journal_lines
      where account_id = v_acct and project_id = r.pid and transaction_id <> t.id;
    if r.amt > owed + 0.005 then
      raise exception 'That is more than the MVR % owed to % for this', to_char(owed, 'FM999,999,999,990.00'),
        (select name from public.contacts where id = r.cid) using errcode = 'P0001';
    end if;
  end loop;
end $$;

/**
 * What waits for a member on completed, paid projects: their principal first;
 * a return or profit share only once the project's other loans are repaid
 * (their own principal, taken first in the same choice, counts as repaid).
 */
create or replace function public.director_waiting(p_contact uuid)
returns table (project_id uuid, component text, amount numeric, completed_at timestamptz) language sql stable set search_path = public, pg_temp as $$
  with w as (
    select j.project_id,
      case par.subtype when 'capital_pool_loans' then 'principal' when 'financing_return_payable' then 'financing_return' else 'profit_share' end component,
      sum(j.home_credit - j.home_debit) amount, min(p.completed_at) completed_at
    from public.journal_lines j
    join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
    join public.projects p on p.id = j.project_id
    where j.book = public.current_book() and j.contact_id = p_contact
      and par.subtype in ('capital_pool_loans', 'financing_return_payable', 'profit_share_payable')
      and p.completed_at is not null and abs(public.client_balance(p.id)) < 0.005
    group by j.project_id, par.subtype
    having sum(j.home_credit - j.home_debit) > 0
  )
  select w.project_id, w.component, w.amount, w.completed_at from w
  where w.component = 'principal'
     or public.project_loans_owed(w.project_id) - coalesce((select o.amount from w o where o.project_id = w.project_id and o.component = 'principal'), 0) <= 0.005
  order by w.completed_at, w.project_id,
    case w.component when 'principal' then 0 when 'financing_return' then 1 else 2 end
$$;

revoke execute on function public.project_loans_owed(uuid, uuid) from public, anon;
grant execute on function public.project_loans_owed(uuid, uuid) to authenticated;
