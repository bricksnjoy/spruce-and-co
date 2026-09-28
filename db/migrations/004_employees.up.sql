-- 004 · Employees and pay items (§7). Rates come from `rates`; which items
-- count toward pension and withholding tax is a flag you can change.

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts,
  name text not null,
  nationality_type text not null default 'maldivian' check (nationality_type in ('maldivian', 'expatriate')),
  job_title text,
  department text not null default 'site' check (department in ('site', 'admin')),
  basic_salary numeric(18,2) not null default 0 check (basic_salary >= 0),
  pension_eligible boolean not null default true,
  wht_applicable boolean not null default true,
  bank_name text,
  bank_account text,
  start_date date,
  end_date date,
  permit_no text,
  permit_expiry date,
  passport_no text,
  needs_review boolean not null default false,
  active boolean not null default true,
  legacy_person_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- the 4 people are real (R1); directors are paid through payroll as admin staff (Y8).
-- Salary, nationality and bank details were never recorded, so each is marked for review.
insert into public.employees (contact_id, name, job_title, department, needs_review, active, start_date, legacy_person_id)
select c.id, p.name, p.title, case when p.role in ('director', 'shareholder') then 'admin' else 'site' end,
  true, p.active, p.joined_on, p.id
from public.people p
left join public.contacts c on c.legacy ->> 'pool_member_id' = p.pool_member_id::text;

create table public.pay_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('earning', 'deduction', 'employer_contribution')),
  calc text not null check (calc in ('fixed', 'hours', 'days', 'percent', 'bracket')),
  -- for percent and bracket items: which rate
  rate_kind text check (rate_kind in ('pension_employee', 'pension_employer', 'wht')),
  -- earnings: part of the pension / tax base. Deductions: taken off that base (e.g. no-pay)
  pensionable boolean not null default false,
  taxable boolean not null default false,
  -- a deduction that reduces gross pay (no-pay) rather than being withheld from it
  reduces_gross boolean not null default false,
  is_advance_recovery boolean not null default false,
  account_id uuid references public.accounts,
  sort_order int not null default 0,
  active boolean not null default true
);
insert into public.pay_items (code, name, kind, calc, rate_kind, pensionable, taxable, reduces_gross, is_advance_recovery, sort_order) values
  ('BASIC', 'Basic salary', 'earning', 'fixed', null, true, true, false, false, 1),
  ('ISLAND', 'Island / site allowance', 'earning', 'fixed', null, false, true, false, false, 2),
  ('LIVING', 'Living allowance', 'earning', 'fixed', null, false, true, false, false, 3),
  ('TRANSPORT', 'Transport allowance', 'earning', 'fixed', null, false, true, false, false, 4),
  ('PHONE', 'Phone allowance', 'earning', 'fixed', null, false, true, false, false, 5),
  ('OVERTIME', 'Overtime', 'earning', 'hours', null, false, true, false, false, 6),
  ('BONUS', 'Bonus', 'earning', 'fixed', null, false, true, false, false, 7),
  ('NOPAY', 'No-pay / absence', 'deduction', 'days', null, true, true, true, false, 10),
  ('PENSION_EE', 'Employee pension', 'deduction', 'percent', 'pension_employee', false, false, false, false, 11),
  ('WHT', 'Employee withholding tax', 'deduction', 'bracket', 'wht', false, false, false, false, 12),
  ('ADVANCE', 'Salary advance recovery', 'deduction', 'fixed', null, false, false, false, true, 13),
  ('OTHER', 'Other deduction', 'deduction', 'fixed', null, false, false, false, false, 14),
  ('PENSION_ER', 'Employer pension', 'employer_contribution', 'percent', 'pension_employer', false, false, false, false, 20);

/** An employee's standing pay items (allowances, fixed deductions), used to pre-fill each run. */
create table public.employee_pay_items (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees on delete cascade,
  pay_item_id uuid not null references public.pay_items,
  amount numeric(18,2) not null check (amount >= 0),
  unique (employee_id, pay_item_id)
);

/** How an employee's cost is split across projects from a month on (null project = overhead). */
create table public.employee_allocations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees on delete cascade,
  project_id uuid references public.projects,
  percent numeric(7,4) not null check (percent > 0 and percent <= 100),
  effective_from date not null
);
create unique index employee_allocations_one on public.employee_allocations (employee_id, effective_from, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid));

create or replace function public.check_allocation_total() returns trigger language plpgsql as $$
declare e uuid := coalesce(new.employee_id, old.employee_id); d date := coalesce(new.effective_from, old.effective_from); t numeric;
begin
  select sum(percent) into t from public.employee_allocations where employee_id = e and effective_from = d;
  if t is not null and t <> 100 then
    raise exception 'An employee''s allocations must total 100%% (they total %)', t;
  end if;
  return null;
end $$;
create constraint trigger employee_allocations_total after insert or update or delete on public.employee_allocations
  deferrable initially deferred for each row execute function public.check_allocation_total();

create trigger employees_audit after insert or update or delete on public.employees for each row execute function public.log_change();
create trigger pay_items_audit after insert or update or delete on public.pay_items for each row execute function public.log_change();
create trigger employee_pay_items_audit after insert or update or delete on public.employee_pay_items for each row execute function public.log_change();
create trigger employee_allocations_audit after insert or update or delete on public.employee_allocations for each row execute function public.log_change();
