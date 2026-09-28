-- 002 · Chart of accounts (§2). Balances are never stored; they come from journal lines.

create type public.account_type as enum ('asset', 'liability', 'equity', 'income', 'cogs', 'expense');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type public.account_type not null,
  -- what the account is for; control accounts are looked up by it
  subtype text,
  parent_id uuid references public.accounts,
  contact_id uuid,                      -- per-person sub-accounts; FK added with contacts
  currency char(3) not null default 'MVR' references public.currencies,
  -- job-cost accounts: which budget category their costs count against
  budget_category text check (budget_category in ('materials', 'subcontractors', 'labour', 'equipment', 'freight', 'site', 'other')),
  is_system boolean not null default false,
  active boolean not null default true,
  -- null: shared by both books (the chart); set for a person's own sub-account
  book text check (book in ('live', 'sandbox')),
  description text,
  created_at timestamptz not null default now()
);
create unique index accounts_one_control on public.accounts (subtype)
  where subtype is not null and subtype not in ('bank', 'fixed_asset');
create index accounts_parent on public.accounts (parent_id);
create unique index accounts_one_sub_per_contact on public.accounts (parent_id, contact_id) where contact_id is not null;

insert into public.accounts (code, name, type, subtype, currency, budget_category, is_system) values
  ('1010', 'Bank – MVR', 'asset', 'bank', 'MVR', null, true),
  ('1020', 'Bank – USD', 'asset', 'bank', 'USD', null, true),
  ('1030', 'Cash', 'asset', 'cash', 'MVR', null, true),
  ('1040', 'Undeposited Funds', 'asset', 'undeposited', 'MVR', null, true),
  ('1100', 'Accounts Receivable', 'asset', 'ar', 'MVR', null, true),
  ('1110', 'Retention Receivable', 'asset', 'retention_receivable', 'MVR', null, true),
  ('1120', 'Contract Asset – Unbilled Revenue', 'asset', 'contract_asset', 'MVR', null, true),
  ('1200', 'GST Input Tax Receivable', 'asset', 'gst_input', 'MVR', null, true),
  ('1210', 'GST Refund / Carry-forward Receivable', 'asset', 'gst_refund', 'MVR', null, true),
  ('1300', 'Staff Advances', 'asset', 'staff_advances', 'MVR', null, true),
  ('1310', 'Prepayments', 'asset', 'prepayments', 'MVR', null, true),
  ('1500', 'Equipment', 'asset', 'fixed_asset', 'MVR', null, true),
  ('1510', 'Vehicles', 'asset', 'fixed_asset', 'MVR', null, true),
  ('1590', 'Accumulated Depreciation', 'asset', 'accumulated_depreciation', 'MVR', null, true),

  ('2000', 'Accounts Payable', 'liability', 'ap', 'MVR', null, true),
  ('2010', 'Credit Card', 'liability', 'credit_card', 'MVR', null, true),
  ('2100', 'GST Output Tax Payable', 'liability', 'gst_output', 'MVR', null, true),
  ('2110', 'GST Payable – MIRA', 'liability', 'gst_payable', 'MVR', null, true),
  ('2200', 'Salaries Payable', 'liability', 'salaries_payable', 'MVR', null, true),
  ('2210', 'Pension Payable', 'liability', 'pension_payable', 'MVR', null, true),
  ('2220', 'Employee Withholding Tax Payable', 'liability', 'wht_payable', 'MVR', null, true),
  ('2230', 'Other Payroll Deductions Payable', 'liability', 'other_deductions_payable', 'MVR', null, true),
  ('2300', 'Business Profit Tax Payable', 'liability', 'bpt_payable', 'MVR', null, true),
  ('2400', 'Customer Advances', 'liability', 'customer_advances', 'MVR', null, true),
  ('2410', 'Retention Payable', 'liability', 'retention_payable', 'MVR', null, true),
  ('2420', 'Contract Liability – Billings in Excess', 'liability', 'contract_liability', 'MVR', null, true),
  ('2500', 'Accrued Expenses', 'liability', 'accrued', 'MVR', null, true),
  ('2600', 'Project Loans', 'liability', 'project_loans', 'MVR', null, true),
  ('2700', 'Capital Pool Loans', 'liability', 'capital_pool_loans', 'MVR', null, true),
  ('2800', 'Financing Return Payable', 'liability', 'financing_return_payable', 'MVR', null, true),
  ('2900', 'Profit Share Payable', 'liability', 'profit_share_payable', 'MVR', null, true),

  ('3000', 'Share Capital', 'equity', 'share_capital', 'MVR', null, true),
  ('3100', 'Retained Earnings', 'equity', 'retained_earnings', 'MVR', null, true),
  ('3200', 'Dividends', 'equity', 'dividends', 'MVR', null, true),
  ('3900', 'Opening Balance Equity', 'equity', 'opening_equity', 'MVR', null, true),

  ('4000', 'Contract Revenue', 'income', 'contract_revenue', 'MVR', null, true),
  ('4010', 'Variation Revenue', 'income', 'variation_revenue', 'MVR', null, true),
  ('4900', 'Other Income', 'income', 'other_income', 'MVR', null, true),

  ('5000', 'Materials', 'cogs', 'materials', 'MVR', 'materials', true),
  ('5010', 'Subcontractors', 'cogs', 'subcontractors', 'MVR', 'subcontractors', true),
  ('5020', 'Direct Labour', 'cogs', 'direct_labour', 'MVR', 'labour', true),
  ('5030', 'Equipment Hire', 'cogs', 'equipment_hire', 'MVR', 'equipment', true),
  ('5040', 'Freight & Logistics', 'cogs', 'freight', 'MVR', 'freight', true),
  ('5050', 'Site Expenses', 'cogs', 'site_expenses', 'MVR', 'site', true),
  ('5060', 'Non-claimable GST', 'cogs', 'non_claimable_gst', 'MVR', 'other', true),

  ('6000', 'Admin Salaries', 'expense', 'admin_salaries', 'MVR', null, true),
  ('6010', 'Employer Pension Contribution', 'expense', 'employer_pension', 'MVR', null, true),
  ('6020', 'Staff Allowances', 'expense', 'staff_allowances', 'MVR', null, true),
  ('6030', 'Work Permits & Visas', 'expense', 'work_permits', 'MVR', null, true),
  ('6040', 'Staff Insurance', 'expense', 'staff_insurance', 'MVR', null, true),
  ('6050', 'Staff Accommodation & Food', 'expense', 'staff_accommodation', 'MVR', null, true),
  ('6100', 'Rent', 'expense', 'rent', 'MVR', null, true),
  ('6110', 'Utilities', 'expense', 'utilities', 'MVR', null, true),
  ('6120', 'Professional Fees', 'expense', 'professional_fees', 'MVR', null, true),
  ('6130', 'Bank Charges', 'expense', 'bank_charges', 'MVR', null, true),
  ('6200', 'Depreciation', 'expense', 'depreciation', 'MVR', null, true),
  ('6210', 'Bad Debts', 'expense', 'bad_debts', 'MVR', null, true),
  ('6220', 'FX Gain/Loss', 'expense', 'fx', 'MVR', null, true),
  ('6300', 'Finance Cost – Profit Participation', 'expense', 'finance_cost', 'MVR', null, true),
  ('6310', 'Profit Share', 'expense', 'profit_share', 'MVR', null, true),
  ('6400', 'Income Tax Expense (BPT)', 'expense', 'income_tax', 'MVR', null, true);

/** The control account for a subtype; missing ones are a setup error, not a silent null. */
create or replace function public.acct(p_subtype text)
returns uuid language plpgsql stable as $$
declare v uuid;
begin
  select id into v from public.accounts where subtype = p_subtype and parent_id is null and subtype not in ('bank', 'fixed_asset');
  if v is null then raise exception 'No % account in the chart of accounts', p_subtype; end if;
  return v;
end $$;

/** A person's own sub-account under a parent (created the first time it is needed). */
create or replace function public.sub_account(p_parent_subtype text, p_contact uuid)
returns uuid language plpgsql as $$
declare parent public.accounts; v uuid; nm text; bk text; n int;
begin
  if p_contact is null then raise exception 'A % line needs a contact', p_parent_subtype; end if;
  select * into parent from public.accounts where id = public.acct(p_parent_subtype);
  select id into v from public.accounts where parent_id = parent.id and contact_id = p_contact;
  if v is not null then return v; end if;
  execute 'select name, book from public.contacts where id = $1' into nm, bk using p_contact;
  select count(*) + 1 into n from public.accounts where parent_id = parent.id;
  insert into public.accounts (code, name, type, parent_id, contact_id, currency, is_system, book)
  values (parent.code || '-' || lpad(n::text, 2, '0') || case when bk = 'sandbox' then 'T' else '' end,
    parent.name || ' – ' || coalesce(nm, 'contact'), parent.type, parent.id, p_contact, parent.currency, true, bk)
  returning id into v;
  return v;
end $$;

/** System accounts keep their type and purpose; a sub-account shares its parent's type. */
create or replace function public.guard_account() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and public._purging() and old.book = 'sandbox' then return old; end if;
  if tg_op = 'DELETE' then
    if old.is_system then raise exception '% is a system account and cannot be deleted; make it inactive instead', old.name; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.is_system and (new.type <> old.type or new.subtype is distinct from old.subtype or new.parent_id is distinct from old.parent_id) then
    raise exception '% is a system account: its type and purpose cannot change', old.name;
  end if;
  if new.parent_id is not null and (select type from public.accounts where id = new.parent_id) <> new.type then
    raise exception 'A sub-account must have the same type as its parent';
  end if;
  return new;
end $$;
create trigger accounts_guard before insert or update or delete on public.accounts for each row execute function public.guard_account();
create trigger accounts_audit after insert or update or delete on public.accounts for each row execute function public.log_change();
