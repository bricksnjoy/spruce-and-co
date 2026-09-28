-- 005 · The ledger (§1, §3).
-- Every source document is a row in `transactions` with what was typed in
-- `transaction_lines`. `post_transaction()` turns it into `journal_lines`;
-- nothing else writes the journal. A deferred trigger refuses any commit in
-- which a transaction's debits and credits differ.

create type public.txn_type as enum (
  'estimate', 'invoice', 'credit_note', 'sales_receipt', 'customer_payment', 'deposit', 'customer_advance', 'advance_application',
  'purchase_order', 'bill', 'vendor_credit', 'bill_payment', 'expense',
  'transfer', 'journal', 'opening_balance',
  'payroll_run', 'salary_payment', 'payroll_remittance', 'staff_advance',
  'loan_receipt', 'capital_contribution', 'distribution', 'payout',
  'gst_settlement', 'gst_payment', 'bpt_provision',
  'bad_debt', 'wip_adjustment', 'fx_revaluation', 'depreciation'
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'service' check (type in ('service', 'product', 'other')),
  income_account_id uuid references public.accounts,
  expense_account_id uuid references public.accounts,
  tax_code_id uuid references public.tax_codes,
  default_rate numeric(18,4),
  active boolean not null default true
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  type public.txn_type not null,
  number text,
  date date not null,
  due_date date,
  contact_id uuid references public.contacts,
  project_id uuid references public.projects,
  employee_id uuid references public.employees,
  -- the bank, cash, card or undeposited-funds account money moved through
  bank_account_id uuid references public.accounts,
  -- for documents that are one amount (payments, transfers, loans, advances …)
  total_amount numeric(18,2) check (total_amount >= 0),
  currency char(3) not null default 'MVR' references public.currencies,
  fx_rate numeric(18,6) not null default 1 check (fx_rate > 0),
  memo text,
  reference text,
  terms_days int,
  -- evidence for claiming input GST (§8)
  supplier_tin text,
  tax_invoice_no text,
  tax_invoice_date date,
  customs_ref text,
  is_draft boolean not null default false,
  sent_at timestamptz,
  approval_status text not null default 'not_required' check (approval_status in ('not_required', 'pending', 'approved')),
  approved_by uuid,
  approved_at timestamptz,
  payroll_run_id uuid,
  tax_period_id uuid,
  distribution_id uuid,
  reverses_id uuid references public.transactions,
  adjusts_id uuid references public.transactions,
  recurring_id uuid,
  voided_at timestamptz,
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index transactions_number on public.transactions (type, number) where number is not null;
create index transactions_type_date on public.transactions (type, date);
create index transactions_contact on public.transactions (contact_id);
create index transactions_project on public.transactions (project_id);

create table public.transaction_lines (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions on delete cascade,
  line_no int not null default 0,
  item_id uuid references public.items,
  account_id uuid references public.accounts,
  description text,
  qty numeric(18,4),
  rate numeric(18,4),
  amount numeric(18,2) not null default 0,
  tax_code_id uuid references public.tax_codes,
  tax_amount numeric(18,2) not null default 0,
  gst_claimable boolean not null default false,
  project_id uuid references public.projects,
  employee_id uuid references public.employees,
  contact_id uuid references public.contacts,
  component text check (component in ('principal', 'financing_return', 'profit_share')),
  -- journal-form documents (journal, opening balance, system postings) state debits and credits directly
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  check (debit = 0 or credit = 0)
);
create index transaction_lines_txn on public.transaction_lines (transaction_id);

create table public.journal_lines (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.transactions,
  line_no int not null,
  date date not null,
  account_id uuid not null references public.accounts,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  home_debit numeric(18,2) not null default 0,
  home_credit numeric(18,2) not null default 0,
  currency char(3) not null default 'MVR',
  fx_rate numeric(18,6) not null default 1,
  contact_id uuid references public.contacts,
  project_id uuid references public.projects,
  employee_id uuid references public.employees,
  tax_period_id uuid,
  component text check (component in ('principal', 'financing_return', 'profit_share')),
  cleared text not null default 'uncleared' check (cleared in ('uncleared', 'cleared', 'reconciled')),
  reconciliation_id uuid,
  memo text,
  check (debit >= 0 and credit >= 0 and (debit = 0 or credit = 0)),
  check (home_debit >= 0 and home_credit >= 0 and (home_debit = 0 or home_credit = 0))
);
create index journal_lines_txn on public.journal_lines (transaction_id);
create index journal_lines_account_date on public.journal_lines (account_id, date);
create index journal_lines_project on public.journal_lines (project_id, account_id) where project_id is not null;
create index journal_lines_contact on public.journal_lines (contact_id, account_id) where contact_id is not null;
create index journal_lines_employee on public.journal_lines (employee_id) where employee_id is not null;
create index journal_lines_period on public.journal_lines (tax_period_id) where tax_period_id is not null;

/** Which payment (or credit, write-off, advance) settles which invoice or bill. */
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  from_transaction_id uuid not null references public.transactions,
  to_transaction_id uuid not null references public.transactions,
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (from_transaction_id, to_transaction_id)
);
create index applications_to on public.applications (to_transaction_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references public.transactions,
  entity text,
  entity_id uuid,
  storage_path text not null,
  file_name text,
  mime text,
  size_bytes bigint,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ── helpers ────────────────────────────────────────────────────────────

create or replace function public.today_mv() returns date language sql stable as $$
  select (now() at time zone 'Indian/Maldives')::date $$;

/** What a document is worth: its lines with GST, or its single amount. */
create or replace function public.doc_total(p_id uuid) returns numeric language sql stable as $$
  select case when t.type in ('invoice', 'credit_note', 'sales_receipt', 'bill', 'vendor_credit', 'expense', 'estimate', 'purchase_order')
    then coalesce((select sum(amount + tax_amount) from public.transaction_lines where transaction_id = t.id), 0)
    else coalesce(t.total_amount, 0) end
  from public.transactions t where t.id = p_id
$$;

/** Add one journal line. Positive amounts are debits, negative credits; zero adds nothing. */
create or replace function public._jl(t public.transactions, p_account uuid, p_amount numeric,
  p_contact uuid, p_project uuid, p_employee uuid, p_memo text, p_component text default null, p_period uuid default null)
returns void language plpgsql as $$
declare v numeric := round(coalesce(p_amount, 0), 2); h numeric;
begin
  if v = 0 then return; end if;
  if p_account is null then raise exception 'A line on this % has no account', replace(t.type::text, '_', ' '); end if;
  if p_contact is null and exists (select 1 from public.accounts where id = p_account and subtype in ('ar', 'ap')) then
    raise exception 'Receivable and payable lines need a customer or vendor';
  end if;
  h := round(abs(v) * t.fx_rate, 2);
  insert into public.journal_lines (transaction_id, line_no, date, account_id, debit, credit, home_debit, home_credit,
    currency, fx_rate, contact_id, project_id, employee_id, tax_period_id, component, memo)
  values (t.id, (select coalesce(max(line_no), 0) + 1 from public.journal_lines where transaction_id = t.id), t.date, p_account,
    greatest(v, 0), greatest(-v, 0), case when v > 0 then h else 0 end, case when v < 0 then h else 0 end,
    t.currency, t.fx_rate, p_contact, p_project, p_employee, p_period, p_component, p_memo);
end $$;

/**
 * Post an amount against `p_account`, split across projects in the same
 * proportions as `p_source`'s lines on `p_weight_account` (how a payment
 * inherits the projects of the invoice it pays). Rounding goes to the largest share.
 */
create or replace function public._split(t public.transactions, p_account uuid, p_amount numeric, p_source uuid, p_weight_account uuid)
returns void language plpgsql as $$
declare w record; v_total numeric; v_left numeric := round(p_amount, 2); v_part numeric; v_n int; i int := 0;
begin
  select sum(wt), count(*) into v_total, v_n from (
    select sum(abs(debit - credit)) wt from public.journal_lines
    where transaction_id = p_source and account_id = p_weight_account group by project_id) g;
  if coalesce(v_total, 0) = 0 then
    perform public._jl(t, p_account, p_amount, t.contact_id, t.project_id, null, null);
    return;
  end if;
  for w in select project_id, sum(abs(debit - credit)) wt from public.journal_lines
           where transaction_id = p_source and account_id = p_weight_account
           group by project_id order by 2 asc, project_id nulls first loop
    i := i + 1;
    -- the last (largest) share takes whatever rounding is left
    v_part := case when i = v_n then v_left else round(p_amount * w.wt / v_total, 2) end;
    perform public._jl(t, p_account, v_part, t.contact_id, w.project_id, null, null);
    v_left := v_left - v_part;
  end loop;
end $$;

/** The bank, cash, card or undeposited-funds account a document moved money through. */
create or replace function public._money_account(t public.transactions, p_default text default null) returns uuid language plpgsql stable as $$
declare v uuid := t.bank_account_id; st text;
begin
  if v is null and p_default is not null then return public.acct(p_default); end if;
  if v is null then raise exception 'Choose the bank or cash account for this %', replace(t.type::text, '_', ' '); end if;
  select subtype into st from public.accounts where id = v;
  if st not in ('bank', 'cash', 'undeposited', 'credit_card') then raise exception 'Money can only move through a bank, cash, card or undeposited-funds account'; end if;
  return v;
end $$;

/** Input GST can only be claimed with a GST-registered supplier and a valid tax invoice (or a customs declaration). */
create or replace function public._check_claim(t public.transactions) returns void language plpgsql stable as $$
declare reg boolean;
begin
  if t.customs_ref is not null and length(trim(t.customs_ref)) > 0 then return; end if;
  if coalesce(trim(t.supplier_tin), '') = '' or coalesce(trim(t.tax_invoice_no), '') = '' or t.tax_invoice_date is null then
    raise exception 'Input GST can only be claimed with the supplier''s TIN, tax invoice number and date';
  end if;
  select gst_registered into reg from public.contacts where id = t.contact_id;
  if not coalesce(reg, false) then
    raise exception 'Input GST can only be claimed from a GST-registered supplier';
  end if;
end $$;

-- hooks that later migrations fill in (GST periods, profit-split adjustments, payout gate)
create or replace function public._line_frozen(p_period uuid) returns boolean language sql stable as $$ select false $$;
create or replace function public._gst_after_post(p_id uuid) returns void language plpgsql as $$ begin end $$;
create or replace function public._after_post(p_id uuid, p_old_projects uuid[]) returns void language plpgsql as $$ begin end $$;
create or replace function public._payout_gate(t public.transactions) returns void language plpgsql as $$ begin end $$;

/** Line amounts from quantity × rate, and GST from the tax code's rate on the document date. */
create or replace function public._recalc_lines(t public.transactions) returns void language plpgsql as $$
begin
  if t.type not in ('invoice', 'credit_note', 'sales_receipt', 'bill', 'vendor_credit', 'expense', 'estimate', 'purchase_order') then return; end if;
  update public.transaction_lines set amount = round(qty * rate, 2)
    where transaction_id = t.id and qty is not null and rate is not null and amount <> round(qty * rate, 2);
  -- sales GST always follows the code; a supplier's own GST figure is kept when no code is given
  update public.transaction_lines set tax_amount = round(amount * public.tax_rate(tax_code_id, t.date) / 100, 2)
    where transaction_id = t.id and tax_code_id is not null;
end $$;

-- ── posting rules (§3) ─────────────────────────────────────────────────

create or replace function public._post_rules(t public.transactions) returns void language plpgsql as $$
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

/** FX rounding: a foreign-currency document whose MVR amounts miss by a few laari. */
create or replace function public._fx_balance(t public.transactions) returns void language plpgsql as $$
declare d numeric;
begin
  if t.fx_rate = 1 then return; end if;
  select sum(home_debit) - sum(home_credit) into d from public.journal_lines where transaction_id = t.id;
  if coalesce(d, 0) <> 0 and abs(d) <= 1 then
    insert into public.journal_lines (transaction_id, line_no, date, account_id, home_debit, home_credit, currency, fx_rate, memo)
    values (t.id, (select max(line_no) + 1 from public.journal_lines where transaction_id = t.id), t.date, public.acct('fx'),
      greatest(-d, 0), greatest(d, 0), 'MVR', 1, 'Exchange rounding');
  end if;
end $$;

/**
 * Post a document: delete its journal lines and write them again from what it
 * says now (§1 "post on save"). A draft, void, estimate or purchase order has
 * none. Callers run this in the same database transaction as the save.
 */
create or replace function public.post_transaction(p_id uuid) returns void language plpgsql as $$
declare t public.transactions; v_old uuid[];
begin
  select * into t from public.transactions where id = p_id for update;
  if not found then raise exception 'No such transaction'; end if;
  select coalesce(array_agg(distinct project_id) filter (where project_id is not null), '{}') into v_old
    from public.journal_lines where transaction_id = p_id;
  delete from public.journal_lines where transaction_id = p_id and not public._line_frozen(tax_period_id);
  if t.voided_at is null and not t.is_draft and t.type not in ('estimate', 'purchase_order') then
    perform public._recalc_lines(t);
    -- an edit may not leave a document worth less than what is applied to or from it
    if coalesce((select sum(amount) from public.applications where to_transaction_id = p_id), 0) > public.doc_total(p_id)
       or coalesce((select sum(amount) from public.applications where from_transaction_id = p_id), 0) > public.doc_total(p_id) then
      raise exception 'More is applied to this % than its new total; remove or reduce the payments first', replace(t.type::text, '_', ' ')
        using errcode = 'P0001';
    end if;
    perform public._post_rules(t);
    perform public._fx_balance(t);
  end if;
  perform public._gst_after_post(p_id);
  perform public._after_post(p_id, v_old);
end $$;

/** Void a document: it stays on record with no effect on the books. */
create or replace function public.void_transaction(p_id uuid, p_reason text) returns void language plpgsql as $$
begin
  if exists (select 1 from public.applications a join public.transactions f on f.id = a.from_transaction_id
             where a.to_transaction_id = p_id and f.voided_at is null) then
    raise exception 'Payments or credits are applied to this document; remove or void them first';
  end if;
  delete from public.applications where from_transaction_id = p_id;
  update public.transactions set voided_at = now(), void_reason = nullif(trim(p_reason), ''), updated_at = now() where id = p_id and voided_at is null;
  perform public.post_transaction(p_id);
end $$;

-- ── integrity ──────────────────────────────────────────────────────────

/** Debits equal credits for every transaction, checked when the database transaction commits. */
create or replace function public.check_balanced() returns trigger language plpgsql as $$
declare v uuid := coalesce(new.transaction_id, old.transaction_id); d numeric;
begin
  select coalesce(sum(home_debit), 0) - coalesce(sum(home_credit), 0) into d from public.journal_lines where transaction_id = v;
  if d <> 0 then
    raise exception 'Transaction % does not balance: debits and credits differ by %', v, d using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger journal_balanced after insert or update or delete on public.journal_lines
  deferrable initially deferred for each row execute function public.check_balanced();

/** The closing date: nothing on or before it can be created, changed, voided or deleted. */
create or replace function public.guard_closing_date() returns trigger language plpgsql as $$
declare cd date := (select closing_date from public.settings where id);
begin
  if cd is null then return coalesce(new, old); end if;
  if tg_table_name = 'transactions' and tg_op = 'UPDATE' and old.date <= cd
     and (to_jsonb(new) - array['sent_at', 'updated_at']) = (to_jsonb(old) - array['sent_at', 'updated_at']) then
    return new;  -- marking an old invoice as sent is not a change to the books
  end if;
  if (tg_op <> 'INSERT' and old.date <= cd) or (tg_op <> 'DELETE' and new.date <= cd) then
    raise exception 'The books are closed up to %. Change the closing date in Settings to edit this.', to_char(cd, 'DD Mon YYYY')
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger transactions_closing before insert or update or delete on public.transactions
  for each row execute function public.guard_closing_date();
create trigger journal_lines_closing before insert or update or delete on public.journal_lines
  for each row execute function public.guard_closing_date();

/** Lines of a closed-period document are frozen with it. */
create or replace function public.guard_lines_closing() returns trigger language plpgsql as $$
declare cd date := (select closing_date from public.settings where id); d date;
begin
  if cd is null then return coalesce(new, old); end if;
  select date into d from public.transactions where id = coalesce(new.transaction_id, old.transaction_id);
  if d <= cd then
    raise exception 'The books are closed up to %. Change the closing date in Settings to edit this.', to_char(cd, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger transaction_lines_closing before insert or update or delete on public.transaction_lines
  for each row execute function public.guard_lines_closing();

/** Posted documents are voided, never deleted (§1). Drafts, estimates and POs can go. */
create or replace function public.guard_txn_delete() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.journal_lines where transaction_id = old.id)
     or (not old.is_draft and old.type not in ('estimate', 'purchase_order')) then
    raise exception 'Posted documents cannot be deleted; void it instead' using errcode = 'P0001';
  end if;
  delete from public.applications where from_transaction_id = old.id or to_transaction_id = old.id;
  return old;
end $$;
create trigger transactions_no_delete before delete on public.transactions for each row execute function public.guard_txn_delete();

/** A claimable GST line needs its evidence on the document (the database refuses otherwise). */
create or replace function public.guard_claimable() returns trigger language plpgsql as $$
declare t public.transactions;
begin
  if not new.gst_claimable then return new; end if;
  select * into t from public.transactions where id = new.transaction_id;
  if t.is_draft or t.type not in ('bill', 'expense', 'vendor_credit') then return new; end if;
  perform public._check_claim(t);
  return new;
end $$;
create constraint trigger transaction_lines_claimable after insert or update on public.transaction_lines
  deferrable initially deferred for each row execute function public.guard_claimable();

/** Payments settle invoices, supplier payments settle bills, never more than is owed. */
create or replace function public.check_application() returns trigger language plpgsql as $$
declare f public.transactions; t public.transactions; v numeric;
begin
  if tg_op = 'DELETE' then return null; end if;
  select * into f from public.transactions where id = new.from_transaction_id;
  select * into t from public.transactions where id = new.to_transaction_id;
  if f.voided_at is not null or t.voided_at is not null then raise exception 'A void document cannot be applied'; end if;
  if f.is_draft or t.is_draft then raise exception 'A draft cannot be applied'; end if;
  if f.contact_id is distinct from t.contact_id then raise exception 'A payment can only settle documents of the same contact'; end if;
  if not ((t.type = 'invoice' and f.type in ('customer_payment', 'credit_note', 'advance_application', 'bad_debt'))
       or (t.type = 'bill' and f.type in ('bill_payment', 'vendor_credit'))) then
    raise exception 'A % cannot be applied to a %', replace(f.type::text, '_', ' '), replace(t.type::text, '_', ' ');
  end if;
  select coalesce(sum(amount), 0) into v from public.applications where to_transaction_id = t.id;
  if v > public.doc_total(t.id) then raise exception 'More is applied to % than it is for', coalesce(t.number, 'this document'); end if;
  select coalesce(sum(amount), 0) into v from public.applications where from_transaction_id = f.id;
  if v > public.doc_total(f.id) then raise exception 'More is applied from % than its amount', coalesce(f.number, 'this payment'); end if;
  return null;
end $$;
create constraint trigger applications_valid after insert or update on public.applications
  deferrable initially deferred for each row execute function public.check_application();

-- ── derived balances and statuses (never stored) ───────────────────────

create or replace view public.document_balances_v as
select t.id, t.type, t.number, t.date, t.due_date, t.contact_id, t.project_id,
  public.doc_total(t.id) as total,
  coalesce((select sum(a.amount) from public.applications a where a.to_transaction_id = t.id), 0) as applied,
  coalesce((select sum(a.amount) from public.applications a where a.from_transaction_id = t.id), 0) as applied_from,
  public.doc_total(t.id) - coalesce((select sum(a.amount) from public.applications a where a.to_transaction_id = t.id), 0) as balance,
  t.is_draft, t.sent_at, t.voided_at
from public.transactions t;

/** Void, Draft, Paid, Overdue, Partial, Sent or Open — from the payments applied, in that order. */
create or replace function public.document_status(p_id uuid) returns text language sql stable as $$
  select case
    when b.voided_at is not null then 'void'
    when b.is_draft then 'draft'
    when b.type not in ('invoice', 'bill') then 'posted'
    when b.total > 0 and b.applied >= b.total then 'paid'
    when b.balance > 0 and b.due_date < public.today_mv() then 'overdue'
    when b.applied > 0 then 'partial'
    when b.sent_at is not null then 'sent'
    else 'open' end
  from public.document_balances_v b where b.id = p_id
$$;

create trigger transactions_audit after insert or update or delete on public.transactions for each row execute function public.log_change();
create trigger transaction_lines_audit after insert or update or delete on public.transaction_lines for each row execute function public.log_change();
create trigger applications_audit after insert or update or delete on public.applications for each row execute function public.log_change();
create trigger items_audit after insert or update or delete on public.items for each row execute function public.log_change();
