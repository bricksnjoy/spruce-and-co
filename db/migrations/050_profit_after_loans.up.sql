-- 050 · Profit is worked out and shared only once the project is clear: the
-- client has paid, every receipt and expense charged to it is paid, and every
-- loan to it (lenders and the Capital Pool) is repaid. So loans can now be
-- repaid as soon as the client has paid, before completion, and completing a
-- project (which posts the profit split) is refused until it is clear.

/** Why a project is not clear for its profit split yet, or null when it is. */
create or replace function public.profit_hold(p_project uuid) returns text language sql stable set search_path = public, pg_temp as $$
  with unpaid as (
    select coalesce(sum(d.balance), 0) v from public.document_balances_v d
    where d.type in ('bill', 'expense') and d.voided_at is null and not d.is_draft and d.balance > 0.005
      and (d.project_id = p_project or exists (select 1 from public.transaction_lines l where l.transaction_id = d.id and l.project_id = p_project))
  ), loans as (
    select coalesce(sum(j.home_credit - j.home_debit), 0) v
    from public.journal_lines j join public.accounts a on a.id = j.account_id join public.accounts par on par.id = a.parent_id
    where par.subtype in ('project_loans', 'capital_pool_loans') and j.project_id = p_project
  )
  select nullif(concat_ws('; ',
    case when abs(public.client_balance(p_project)) >= 0.005 then 'the client still owes MVR ' || to_char(public.client_balance(p_project), 'FM999,999,999,990.00') end,
    case when u.v > 0.005 then 'receipts of MVR ' || to_char(u.v, 'FM999,999,999,990.00') || ' are still to pay' end,
    case when l.v > 0.005 then 'loans of MVR ' || to_char(l.v, 'FM999,999,999,990.00') || ' are still to repay' end), '')
  from unpaid u, loans l
$$;

create or replace function public.rpc_complete_project(p_project uuid, p_date date) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare why text;
begin
  perform public.require_role('write');
  perform public._require_book((select book from public.projects where id = p_project));
  why := public.profit_hold(p_project);
  if why is not null then
    raise exception 'The profit is split once the project is clear: %', why using errcode = 'P0001';
  end if;
  return public.complete_project(p_project, p_date);
end $$;

create or replace function public._payout_gate(t public.transactions) returns void language plpgsql set search_path = public, pg_temp as $$
declare r record; cb numeric; owed numeric; v_acct uuid;
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
    v_acct := case r.component
      when 'principal' then public.sub_account(case when exists (select 1 from public.contacts where id = r.cid and 'partner' = any (kinds))
        then 'capital_pool_loans' else 'project_loans' end, r.cid)
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

