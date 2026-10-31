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


create or replace function public._post_rules(t public.transactions) returns void language plpgsql set search_path = public, pg_temp as $$
declare
  l record; a record; r record;
  s int; v_total numeric; v_applied numeric; v_money uuid; v_acct uuid; v_claim boolean; v_type text := replace(t.type::text, '_', ' '); v_who text; v_min int;
begin
  if t.type in ('invoice', 'credit_note', 'sales_receipt', 'bill', 'vendor_credit', 'expense')
     and not exists (select 1 from public.transaction_lines where transaction_id = t.id) then
    raise exception 'A % needs at least one line', v_type;
  end if;
  if t.type in ('invoice', 'credit_note', 'customer_payment', 'customer_advance', 'advance_application', 'bad_debt',
                'bill', 'vendor_credit', 'bill_payment', 'loan_receipt', 'capital_contribution') and t.contact_id is null then
    v_who := case when t.type in ('bill', 'vendor_credit', 'bill_payment') then 'supplier'
      when t.type = 'loan_receipt' then 'lender' when t.type = 'capital_contribution' then 'partner' else 'customer' end;
    raise exception 'Choose the % for this %', v_who, v_type;
  end if;
  v_total := public.doc_total(t.id);

  case t.type
  -- 1, 4, 5 · invoice, sales receipt, credit note
  when 'invoice', 'sales_receipt', 'credit_note' then
    s := case when t.type = 'credit_note' then 1 else -1 end;
    for l in select tl.*, coalesce(tl.project_id, t.project_id) proj from public.transaction_lines tl where transaction_id = t.id order by line_no loop
      v_acct := coalesce(l.account_id, public.acct('contract_revenue'));
      if (select type from public.accounts where id = v_acct) <> 'income' then raise exception 'Sales lines go to an income account'; end if;
      perform public._jl(t, v_acct, s * l.amount, t.contact_id, l.proj, null, l.description);
      perform public._jl(t, public.acct('gst_output'), s * l.tax_amount, t.contact_id, l.proj, null, 'GST');
    end loop;
    if t.type = 'sales_receipt' then
      perform public._jl(t, public._money_account(t, 'undeposited'), -s * v_total, t.contact_id, t.project_id, null, null);
    else
      for r in select coalesce(project_id, t.project_id) proj, sum(amount + tax_amount) tot
               from public.transaction_lines where transaction_id = t.id group by 1 loop
        perform public._jl(t, public.acct('ar'), -s * r.tot, t.contact_id, r.proj, null, null);
      end loop;
    end if;

  -- 2 · payment received: to the bank or Undeposited Funds, off the invoices it pays
  when 'customer_payment' then
    if v_total <= 0 then raise exception 'Enter the amount received'; end if;
    perform public._jl(t, public._money_account(t, 'undeposited'), v_total, t.contact_id, null, null, null);
    v_applied := 0;
    for a in select to_transaction_id, amount from public.applications where from_transaction_id = t.id loop
      perform public._split(t, public.acct('ar'), -a.amount, a.to_transaction_id, public.acct('ar'));
      v_applied := v_applied + a.amount;
    end loop;
    perform public._jl(t, public.acct('ar'), -(v_total - v_applied), t.contact_id, t.project_id, null, 'Unapplied');

  -- 3 · bank deposit of undeposited funds
  when 'deposit' then
    perform public._jl(t, public._money_account(t), v_total, t.contact_id, null, null, null);
    perform public._jl(t, public.acct('undeposited'), -v_total, t.contact_id, null, null, null);

  -- 6 · client advance
  when 'customer_advance' then
    perform public._jl(t, public._money_account(t), v_total, t.contact_id, t.project_id, null, null);
    perform public._jl(t, public.acct('customer_advances'), -v_total, t.contact_id, t.project_id, null, null);

  -- 7, 16 · advance applied to an invoice; bad debt written off
  when 'advance_application', 'bad_debt' then
    v_acct := public.acct(case when t.type = 'bad_debt' then 'bad_debts' else 'customer_advances' end);
    v_applied := 0;
    for a in select to_transaction_id, amount from public.applications where from_transaction_id = t.id loop
      perform public._split(t, v_acct, a.amount, a.to_transaction_id, public.acct('ar'));
      perform public._split(t, public.acct('ar'), -a.amount, a.to_transaction_id, public.acct('ar'));
      v_applied := v_applied + a.amount;
    end loop;
    if v_applied <> v_total then raise exception 'A % must be applied in full to the invoices it covers', v_type; end if;

  -- 8, 9, 11, 12 · bill, expense, vendor credit
  when 'bill', 'expense', 'vendor_credit' then
    s := case when t.type = 'vendor_credit' then -1 else 1 end;
    for l in select tl.*, coalesce(tl.project_id, t.project_id) proj from public.transaction_lines tl where transaction_id = t.id order by line_no loop
      if l.account_id is null then raise exception 'Each line needs an account'; end if;
      v_claim := l.gst_claimable and l.tax_amount <> 0;
      if v_claim then perform public._check_claim(t); end if;
      -- GST that cannot be claimed is part of the cost
      perform public._jl(t, l.account_id, s * (l.amount + case when v_claim then 0 else l.tax_amount end), t.contact_id, l.proj, l.employee_id, l.description);
      if v_claim then perform public._jl(t, public.acct('gst_input'), s * l.tax_amount, t.contact_id, l.proj, null, 'GST'); end if;
    end loop;
    if t.type = 'expense' then
      perform public._jl(t, public._money_account(t), -v_total, t.contact_id, null, null, null);
    else
      for r in select coalesce(project_id, t.project_id) proj, sum(amount + tax_amount) tot
               from public.transaction_lines where transaction_id = t.id group by 1 loop
        perform public._jl(t, public.acct('ap'), -s * r.tot, t.contact_id, r.proj, null, null);
      end loop;
    end if;

  -- 10 · bill payment
  when 'bill_payment' then
    if v_total <= 0 then raise exception 'Enter the amount paid'; end if;
    perform public._jl(t, public._money_account(t), -v_total, t.contact_id, null, null, null);
    v_applied := 0;
    for a in select to_transaction_id, amount from public.applications where from_transaction_id = t.id loop
      perform public._split(t, public.acct('ap'), a.amount, a.to_transaction_id, public.acct('ap'));
      v_applied := v_applied + a.amount;
    end loop;
    perform public._jl(t, public.acct('ap'), v_total - v_applied, t.contact_id, t.project_id, null, 'Unapplied');

  -- 13 · transfer between money accounts (the destination is the first line's account)
  when 'transfer' then
    select account_id into v_acct from public.transaction_lines where transaction_id = t.id order by line_no limit 1;
    v_money := public._money_account(t);
    if v_acct is null or v_acct = v_money then raise exception 'Choose two different accounts to transfer between'; end if;
    if (select subtype from public.accounts where id = v_acct) not in ('bank', 'cash', 'undeposited', 'credit_card') then
      raise exception 'Transfers go between bank, cash and card accounts';
    end if;
    perform public._jl(t, v_acct, v_total, null, null, null, t.memo);
    perform public._jl(t, v_money, -v_total, null, null, null, t.memo);

  -- 17, 18 · external loan received; capital-pool contribution
  when 'loan_receipt', 'capital_contribution' then
    if t.project_id is null then raise exception 'Choose the project this money finances'; end if;
    if t.type = 'loan_receipt' and not exists (select 1 from public.contacts where id = t.contact_id and 'lender' = any (kinds)) then
      raise exception 'A project loan comes from a lender';
    end if;
    if t.type = 'capital_contribution' and not exists (select 1 from public.contacts where id = t.contact_id and 'partner' = any (kinds)) then
      raise exception 'A capital-pool contribution comes from a partner';
    end if;
    perform public._jl(t, public._money_account(t), v_total, t.contact_id, t.project_id, null, null);
    perform public._jl(t, public.sub_account(case when t.type = 'loan_receipt' then 'project_loans' else 'capital_pool_loans' end, t.contact_id),
      -v_total, t.contact_id, t.project_id, null, null, 'principal');

  -- 20 · payout: each component out of its own payable
  when 'payout' then
    perform public._payout_gate(t);
    v_total := 0;
    for l in select * from public.transaction_lines where transaction_id = t.id order by line_no loop
      if l.component is null then raise exception 'Each payout line says whether it is principal, financing return or profit share'; end if;
      if coalesce(l.project_id, t.project_id) is null then raise exception 'Each payout line needs its project'; end if;
      v_acct := case l.component
        when 'principal' then public.sub_account(
          case when exists (select 1 from public.contacts where id = coalesce(l.contact_id, t.contact_id) and 'partner' = any (kinds))
            then 'capital_pool_loans' else 'project_loans' end, coalesce(l.contact_id, t.contact_id))
        when 'financing_return' then public.sub_account('financing_return_payable', coalesce(l.contact_id, t.contact_id))
        else public.sub_account('profit_share_payable', coalesce(l.contact_id, t.contact_id)) end;
      perform public._jl(t, v_acct, l.amount, coalesce(l.contact_id, t.contact_id), coalesce(l.project_id, t.project_id), null, l.description, l.component);
      v_total := v_total + l.amount;
    end loop;
    if v_total <= 0 then raise exception 'A payout needs at least one amount'; end if;
    perform public._jl(t, public._money_account(t), -v_total, t.contact_id, null, null, null);

  -- 22 · salaries paid
  when 'salary_payment' then
    v_total := 0;
    for l in select * from public.transaction_lines where transaction_id = t.id order by line_no loop
      if l.employee_id is null then raise exception 'Each salary line names the employee'; end if;
      perform public._jl(t, public.acct('salaries_payable'), l.amount, null, null, l.employee_id, l.description);
      v_total := v_total + l.amount;
    end loop;
    perform public._jl(t, public._money_account(t), -v_total, null, null, null, null);

  -- 23 · pension or withholding tax paid over
  when 'payroll_remittance' then
    v_total := 0;
    for l in select tl.*, ac.subtype st from public.transaction_lines tl join public.accounts ac on ac.id = tl.account_id where tl.transaction_id = t.id loop
      if l.st not in ('pension_payable', 'wht_payable', 'other_deductions_payable') then
        raise exception 'A remittance pays pension, withholding tax or other deductions';
      end if;
      perform public._jl(t, l.account_id, l.amount, null, null, l.employee_id, l.description);
      v_total := v_total + l.amount;
    end loop;
    perform public._jl(t, public._money_account(t), -v_total, null, null, null, null);

  -- 24 · staff advance
  when 'staff_advance' then
    if t.employee_id is null then raise exception 'Choose the employee'; end if;
    perform public._jl(t, public.acct('staff_advances'), v_total, null, null, t.employee_id, t.memo);
    perform public._jl(t, public._money_account(t), -v_total, null, null, t.employee_id, t.memo);

  -- 27 · GST paid to MIRA
  when 'gst_payment' then
    if t.tax_period_id is null or not public._line_frozen(t.tax_period_id) then
      raise exception 'GST is paid against a filed return';
    end if;
    perform public._jl(t, public.acct('gst_payable'), v_total, null, null, null, null, null, t.tax_period_id);
    perform public._jl(t, public._money_account(t), -v_total, null, null, null, null);

  -- 14, 15, 19, 21, 25, 26, 28–31 · documents that state their debits and credits
  when 'journal', 'opening_balance', 'distribution', 'payroll_run', 'gst_settlement', 'bpt_provision',
       'wip_adjustment', 'fx_revaluation', 'depreciation' then
    v_min := case when t.type = 'opening_balance' then 1 else 2 end;
    if (select count(*) from public.transaction_lines where transaction_id = t.id) < v_min then
      raise exception 'A % needs at least % lines', v_type, v_min;
    end if;
    for l in select * from public.transaction_lines where transaction_id = t.id order by line_no loop
      perform public._jl(t, l.account_id, l.debit - l.credit, coalesce(l.contact_id, t.contact_id),
        coalesce(l.project_id, t.project_id), l.employee_id, l.description, l.component,
        case when t.type = 'gst_settlement' then t.tax_period_id end);
    end loop;
    if t.type = 'opening_balance' then
      select sum(debit - credit) into v_total from public.transaction_lines where transaction_id = t.id;
      perform public._jl(t, public.acct('opening_equity'), -v_total, null, null, null, 'Opening balance difference');
    end if;

  else
    null;  -- estimate, purchase order: no journal
  end case;
end $$;


drop function if exists public.profit_hold(uuid);
drop function if exists public._principal_account(uuid, uuid, uuid);
