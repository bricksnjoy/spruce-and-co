-- as 013 and 009 made them (search_path as 014 set it)
create or replace function public.rpc_complete_project(p_project uuid, p_date date) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  perform public._require_book((select book from public.projects where id = p_project));
  return public.complete_project(p_project, p_date);
end $$;

create or replace function public._payout_gate(t public.transactions) returns void language plpgsql set search_path = public, pg_temp as $$
declare r record; cb numeric; owed numeric; v_acct uuid;
begin
  for r in select coalesce(l.project_id, t.project_id) pid, coalesce(l.contact_id, t.contact_id) cid, l.component, sum(l.amount) amt
           from public.transaction_lines l where l.transaction_id = t.id group by 1, 2, 3 loop
    if not exists (select 1 from public.projects where id = r.pid and completed_at is not null) then
      raise exception 'Payouts start once the project is completed' using errcode = 'P0001';
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


drop function if exists public.profit_hold(uuid);
