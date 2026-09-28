-- 007 · Payroll (§7). Draft → Review → Approved (posted on approval) → Paid (derived).

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_month date not null check (extract(day from period_month) = 1),
  pay_date date not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'posted')),
  journal_transaction_id uuid references public.transactions,
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  book text not null default public.current_book() check (book in ('live', 'sandbox')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (book, period_month)
);

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs on delete cascade,
  employee_id uuid not null references public.employees,
  -- a snapshot, recalculated until the run is approved; the ledger stays the record
  gross numeric(18,2) not null default 0,
  deductions numeric(18,2) not null default 0,
  employer_contributions numeric(18,2) not null default 0,
  net numeric(18,2) not null default 0,
  unique (run_id, employee_id)
);

create table public.payslip_lines (
  id uuid primary key default gen_random_uuid(),
  payslip_id uuid not null references public.payslips on delete cascade,
  pay_item_id uuid not null references public.pay_items,
  quantity numeric(18,4),
  rate numeric(18,4),
  amount numeric(18,2) not null default 0,
  -- pension and withholding tax are worked out, not typed
  computed boolean not null default false
);
create index payslip_lines_slip on public.payslip_lines (payslip_id);

create table public.labour_allocations (
  id uuid primary key default gen_random_uuid(),
  payslip_id uuid not null references public.payslips on delete cascade,
  project_id uuid references public.projects,       -- null: overhead
  basis text not null default 'percent' check (basis in ('percent', 'hours', 'days')),
  quantity numeric(18,4) not null check (quantity > 0),  -- the percentage, for basis 'percent'
  amount numeric(18,2) not null default 0
);

create table public.advance_recoveries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees,
  advance_transaction_id uuid references public.transactions,
  instalment numeric(18,2) not null check (instalment > 0),
  start_month date not null,
  active boolean not null default true
);

create or replace function public.guard_run_editable() returns trigger language plpgsql as $$
declare st text; v_run uuid; v_slip uuid;
begin
  if tg_op = 'DELETE' and public._purging() then return old; end if;
  if tg_table_name = 'payslips' then
    v_run := case when tg_op = 'DELETE' then old.run_id else new.run_id end;
  else
    v_slip := case when tg_op = 'DELETE' then old.payslip_id else new.payslip_id end;
    select run_id into v_run from public.payslips where id = v_slip;
  end if;
  select status into st from public.payroll_runs where id = v_run;
  if st in ('approved', 'posted') then raise exception 'This payroll run is approved; it can no longer change' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end $$;
create trigger payslips_editable before insert or update or delete on public.payslips for each row execute function public.guard_run_editable();
create trigger payslip_lines_editable before insert or update or delete on public.payslip_lines for each row execute function public.guard_run_editable();
create trigger labour_allocations_editable before insert or update or delete on public.labour_allocations for each row execute function public.guard_run_editable();

/** What an employee still owes on salary advances. */
create or replace function public.staff_advance_balance(p_employee uuid) returns numeric language sql stable as $$
  select coalesce(sum(j.home_debit - j.home_credit), 0) from public.journal_lines j
  where j.employee_id = p_employee and j.account_id = public.acct('staff_advances')
$$;

/** Split an amount by percentages, in laari, remainder to the largest share. */
create or replace function public._alloc(p_amount numeric, p_pct numeric, p_total_pct numeric, p_is_last boolean, p_so_far numeric)
returns numeric language sql immutable as $$
  select case when p_is_last then p_amount - p_so_far else round(p_amount * p_pct / p_total_pct, 2) end
$$;

/** Gross to net for one payslip, from its lines, the employee and the dated rates. */
create or replace function public.calc_payslip(p_payslip uuid) returns void language plpgsql as $$
declare
  s public.payslips; e public.employees; r public.payroll_runs; month_end date;
  v_basic numeric; v_div numeric; l record;
  earnings numeric := 0; reduces numeric := 0; pens_base numeric := 0; tax_base numeric := 0;
  withheld numeric := 0; pension_ee numeric := 0; pension_er numeric := 0; wht numeric := 0;
  v_rate numeric; v_brackets jsonb; v_cost numeric; a record; v_n int; i int := 0; v_total_pct numeric; v_left numeric;
begin
  select * into s from public.payslips where id = p_payslip;
  select * into e from public.employees where id = s.employee_id;
  select * into r from public.payroll_runs where id = s.run_id;
  if r.status in ('approved', 'posted') then raise exception 'This payroll run is approved; it can no longer change'; end if;
  month_end := (r.period_month + interval '1 month - 1 day')::date;
  select coalesce(sum(pl.amount), e.basic_salary) into v_basic
    from public.payslip_lines pl join public.pay_items pi on pi.id = pl.pay_item_id where pl.payslip_id = p_payslip and pi.code = 'BASIC';
  v_div := (select nopay_days_divisor from public.settings where id);

  delete from public.payslip_lines where payslip_id = p_payslip and computed;
  -- quantity × rate items (overtime hours, no-pay days)
  update public.payslip_lines pl set amount = round(pl.quantity * coalesce(pl.rate, case when pi.code = 'NOPAY' then v_basic / v_div end), 2)
    from public.pay_items pi
    where pi.id = pl.pay_item_id and pl.payslip_id = p_payslip and pi.calc in ('hours', 'days') and pl.quantity is not null;

  for l in select pl.amount, pi.* from public.payslip_lines pl join public.pay_items pi on pi.id = pl.pay_item_id where pl.payslip_id = p_payslip loop
    if l.kind = 'earning' then
      earnings := earnings + l.amount;
      if l.pensionable then pens_base := pens_base + l.amount; end if;
      if l.taxable then tax_base := tax_base + l.amount; end if;
    elsif l.kind = 'deduction' and l.reduces_gross then
      reduces := reduces + l.amount;
      if l.pensionable then pens_base := pens_base - l.amount; end if;
      if l.taxable then tax_base := tax_base - l.amount; end if;
    elsif l.kind = 'deduction' then
      withheld := withheld + l.amount;
    end if;
  end loop;

  -- pension: Maldivian staff who are eligible (decision Y3)
  if e.pension_eligible and e.nationality_type = 'maldivian' and pens_base > 0 then
    v_rate := public.rate_value('pension_employee', 'default', month_end);
    if v_rate is null then raise exception 'Set the employee pension rate in Settings'; end if;
    pension_ee := round(pens_base * v_rate / 100, 2);
    v_rate := public.rate_value('pension_employer', 'default', month_end);
    if v_rate is null then raise exception 'Set the employer pension rate in Settings'; end if;
    pension_er := round(pens_base * v_rate / 100, 2);
  end if;
  -- withholding tax on the month's taxable pay, by the dated brackets (decision Y4)
  if e.wht_applicable and tax_base > 0 then
    v_brackets := public.rate_brackets('wht', 'default', month_end);
    if v_brackets is null then raise exception 'Enter the withholding-tax brackets in Settings before running payroll'; end if;
    wht := public.bracket_tax(tax_base, v_brackets);
  end if;

  insert into public.payslip_lines (payslip_id, pay_item_id, amount, computed)
  select p_payslip, pi.id, v, true from (values ('PENSION_EE', pension_ee), ('WHT', wht), ('PENSION_ER', pension_er)) x(code, v)
  join public.pay_items pi on pi.code = x.code where v <> 0;

  update public.payslips set
    gross = earnings - reduces,
    deductions = withheld + pension_ee + wht,
    employer_contributions = pension_er,
    net = earnings - reduces - withheld - pension_ee - wht
  where id = p_payslip;
  if earnings - reduces - withheld - pension_ee - wht < 0 then
    raise exception '% would be paid less than nothing this month; reduce the deductions', e.name;
  end if;

  -- cost to the company, split over the allocations (admin staff are always overhead)
  v_cost := earnings - reduces + pension_er;
  if e.department = 'admin' then
    delete from public.labour_allocations where payslip_id = p_payslip;
    insert into public.labour_allocations (payslip_id, project_id, quantity, amount) values (p_payslip, null, 100, v_cost);
  else
    select count(*), sum(quantity) into v_n, v_total_pct from public.labour_allocations where payslip_id = p_payslip;
    v_left := v_cost;
    for a in select id, quantity from public.labour_allocations where payslip_id = p_payslip order by quantity, id loop
      i := i + 1;
      update public.labour_allocations set amount = public._alloc(v_cost, a.quantity, 100, i = v_n, v_cost - v_left) where id = a.id;
      v_left := v_left - (select amount from public.labour_allocations where id = a.id);
    end loop;
  end if;
end $$;

/**
 * Start a month's payroll: a payslip per active employee, pre-filled from their
 * salary, standing allowances and deductions, allocations and advance recoveries.
 */
create or replace function public.create_payroll_run(p_month date, p_pay_date date) returns uuid language plpgsql as $$
declare v_run uuid; e record; v_slip uuid; v_month date := date_trunc('month', p_month)::date; month_end date; v_alloc date; v_rec numeric;
begin
  month_end := (v_month + interval '1 month - 1 day')::date;
  insert into public.payroll_runs (period_month, pay_date) values (v_month, p_pay_date) returning id into v_run;
  for e in select * from public.employees where active and book = public.current_book() and (start_date is null or start_date <= month_end)
           and (end_date is null or end_date >= v_month) order by name loop
    insert into public.payslips (run_id, employee_id) values (v_run, e.id) returning id into v_slip;
    insert into public.payslip_lines (payslip_id, pay_item_id, amount)
      select v_slip, id, e.basic_salary from public.pay_items where code = 'BASIC' and e.basic_salary > 0;
    insert into public.payslip_lines (payslip_id, pay_item_id, amount)
      select v_slip, epi.pay_item_id, epi.amount from public.employee_pay_items epi where epi.employee_id = e.id;
    select max(effective_from) into v_alloc from public.employee_allocations where employee_id = e.id and effective_from <= month_end;
    insert into public.labour_allocations (payslip_id, project_id, quantity)
      select v_slip, project_id, percent from public.employee_allocations where employee_id = e.id and effective_from = v_alloc;
    if not exists (select 1 from public.labour_allocations where payslip_id = v_slip) then
      insert into public.labour_allocations (payslip_id, project_id, quantity) values (v_slip, null, 100);
    end if;
    select least(sum(instalment), public.staff_advance_balance(e.id)) into v_rec
      from public.advance_recoveries where employee_id = e.id and active and start_month <= v_month;
    if coalesce(v_rec, 0) > 0 then
      insert into public.payslip_lines (payslip_id, pay_item_id, amount) select v_slip, id, v_rec from public.pay_items where code = 'ADVANCE';
    end if;
    perform public.calc_payslip(v_slip);
  end loop;
  return v_run;
end $$;

/** Move a run to review or back to draft. */
create or replace function public.set_payroll_status(p_run uuid, p_status text) returns void language plpgsql as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.status in ('approved', 'posted') then raise exception 'This payroll run is approved'; end if;
  if p_status not in ('draft', 'review') then raise exception 'Use approve_payroll_run to approve'; end if;
  update public.payroll_runs set status = p_status where id = p_run;
end $$;

/**
 * Approve and post (§7): site labour to Direct Labour on each project, admin and
 * overhead to Admin Salaries and Employer Pension; net, pension, withholding tax,
 * advance recoveries and other deductions to their payables.
 */
create or replace function public.approve_payroll_run(p_run uuid) returns uuid language plpgsql as $$
declare
  r public.payroll_runs; s record; a record; v_txn uuid; n int := 0; month_end date;
  g_left numeric; er_left numeric; g_part numeric; er_part numeric; v_cnt int; i int; v_pct numeric; v_rec numeric; v_other numeric; v_ee numeric; v_wht numeric;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.status in ('approved', 'posted') then raise exception 'This payroll run is already approved'; end if;
  if not exists (select 1 from public.payslips where run_id = p_run) then raise exception 'This payroll run has no payslips'; end if;
  month_end := (r.period_month + interval '1 month - 1 day')::date;

  for s in select ps.*, e.name, e.department from public.payslips ps join public.employees e on e.id = ps.employee_id where ps.run_id = p_run loop
    perform public.calc_payslip(s.id);
    select sum(quantity) into v_pct from public.labour_allocations where payslip_id = s.id;
    if coalesce(v_pct, 0) <> 100 then raise exception '%''s cost is allocated % per cent, not 100', s.name, coalesce(v_pct, 0); end if;
    select coalesce(sum(pl.amount) filter (where pi.is_advance_recovery), 0), coalesce(sum(pl.amount) filter (where pi.code = 'OTHER'), 0)
      into v_rec, v_other from public.payslip_lines pl join public.pay_items pi on pi.id = pl.pay_item_id where pl.payslip_id = s.id;
    if v_rec > public.staff_advance_balance(s.employee_id) then
      raise exception '% is recovering more than they owe on advances', s.name;
    end if;
  end loop;

  insert into public.transactions (type, date, number, payroll_run_id, memo)
  values ('payroll_run', month_end, public.next_doc_number('payroll_run', month_end), p_run, 'Payroll ' || to_char(r.period_month, 'Mon YYYY'))
  returning id into v_txn;

  for s in select ps.*, e.department from public.payslips ps join public.employees e on e.id = ps.employee_id where ps.run_id = p_run loop
    select count(*) into v_cnt from public.labour_allocations where payslip_id = s.id;
    g_left := s.gross; er_left := s.employer_contributions; i := 0;
    for a in select * from public.labour_allocations where payslip_id = s.id order by quantity, id loop
      i := i + 1;
      g_part := case when i = v_cnt then g_left else round(s.gross * a.quantity / 100, 2) end;
      er_part := case when i = v_cnt then er_left else round(s.employer_contributions * a.quantity / 100, 2) end;
      g_left := g_left - g_part; er_left := er_left - er_part;
      if s.department = 'site' and a.project_id is not null then
        n := n + 1;
        insert into public.transaction_lines (transaction_id, line_no, account_id, debit, project_id, employee_id, description)
        values (v_txn, n, public.acct('direct_labour'), g_part + er_part, a.project_id, s.employee_id, 'Site labour');
      else
        n := n + 1;
        insert into public.transaction_lines (transaction_id, line_no, account_id, debit, employee_id, description)
        values (v_txn, n, public.acct('admin_salaries'), g_part, s.employee_id, 'Salary');
        n := n + 1;
        insert into public.transaction_lines (transaction_id, line_no, account_id, debit, employee_id, description)
        values (v_txn, n, public.acct('employer_pension'), er_part, s.employee_id, 'Employer pension');
      end if;
    end loop;
    select coalesce(sum(pl.amount) filter (where pi.is_advance_recovery), 0), coalesce(sum(pl.amount) filter (where pi.code = 'OTHER'), 0),
           coalesce(sum(pl.amount) filter (where pi.code = 'PENSION_EE'), 0), coalesce(sum(pl.amount) filter (where pi.code = 'WHT'), 0)
      into v_rec, v_other, v_ee, v_wht
      from public.payslip_lines pl join public.pay_items pi on pi.id = pl.pay_item_id where pl.payslip_id = s.id;
    insert into public.transaction_lines (transaction_id, line_no, account_id, credit, employee_id, description)
    select v_txn, n + row_number() over (), acct, amt, s.employee_id, d from (values
      (public.acct('salaries_payable'), s.net, 'Net pay'),
      (public.acct('pension_payable'), v_ee + s.employer_contributions, 'Pension'),
      (public.acct('wht_payable'), v_wht, 'Withholding tax'),
      (public.acct('staff_advances'), v_rec, 'Advance recovered'),
      (public.acct('other_deductions_payable'), v_other, 'Other deductions')) x(acct, amt, d)
    where amt <> 0;
    n := n + 5;
  end loop;
  -- zero lines (e.g. no employer pension) add nothing
  delete from public.transaction_lines where transaction_id = v_txn and debit = 0 and credit = 0;

  perform public.post_transaction(v_txn);
  update public.payroll_runs set status = 'posted', journal_transaction_id = v_txn, approved_by = auth.uid(), approved_at = now() where id = p_run;
  return v_txn;
end $$;

/** Pay the run's net salaries from a bank account. */
create or replace function public.pay_salaries(p_run uuid, p_bank uuid, p_date date) returns uuid language plpgsql as $$
declare r public.payroll_runs; v_txn uuid;
begin
  select * into r from public.payroll_runs where id = p_run;
  if r.status <> 'posted' then raise exception 'Approve the payroll run before paying it'; end if;
  insert into public.transactions (type, date, bank_account_id, payroll_run_id, memo)
  values ('salary_payment', p_date, p_bank, p_run, 'Salaries ' || to_char(r.period_month, 'Mon YYYY')) returning id into v_txn;
  insert into public.transaction_lines (transaction_id, line_no, employee_id, amount)
  select v_txn, row_number() over (order by e.name), s.employee_id, s.net - coalesce(paid.amt, 0)
  from public.payslips s join public.employees e on e.id = s.employee_id
  left join (select tl.employee_id, sum(tl.amount) amt from public.transaction_lines tl join public.transactions t on t.id = tl.transaction_id
             where t.payroll_run_id = p_run and t.type = 'salary_payment' and t.voided_at is null group by 1) paid on paid.employee_id = s.employee_id
  where s.run_id = p_run and s.net - coalesce(paid.amt, 0) > 0;
  if not exists (select 1 from public.transaction_lines where transaction_id = v_txn) then raise exception 'Everyone in this run is already paid'; end if;
  perform public.post_transaction(v_txn);
  return v_txn;
end $$;

/** Paid is derived: every payslip's net has gone out. */
create or replace view public.payroll_runs_v as
select r.*,
  coalesce((select sum(net) from public.payslips where run_id = r.id), 0) net_total,
  coalesce((select sum(tl.amount) from public.transaction_lines tl join public.transactions t on t.id = tl.transaction_id
            where t.payroll_run_id = r.id and t.type = 'salary_payment' and t.voided_at is null), 0) paid_total,
  case when r.status <> 'posted' then r.status
       when coalesce((select sum(tl.amount) from public.transaction_lines tl join public.transactions t on t.id = tl.transaction_id
                      where t.payroll_run_id = r.id and t.type = 'salary_payment' and t.voided_at is null), 0)
            >= coalesce((select sum(net) from public.payslips where run_id = r.id), 0) then 'paid'
       else 'posted' end as display_status
from public.payroll_runs r;

create trigger payroll_runs_audit after insert or update or delete on public.payroll_runs for each row execute function public.log_change();
create trigger payslips_audit after insert or update or delete on public.payslips for each row execute function public.log_change();
create trigger payslip_lines_audit after insert or update or delete on public.payslip_lines for each row execute function public.log_change();
create trigger labour_allocations_audit after insert or update or delete on public.labour_allocations for each row execute function public.log_change();
create trigger advance_recoveries_audit after insert or update or delete on public.advance_recoveries for each row execute function public.log_change();
