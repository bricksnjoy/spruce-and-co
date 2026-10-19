-- 022 · Payroll screens (Phase 4, module 6).
-- • Employees carry a phone and email (the Message Center reaches staff by them).
-- • People and employees are one list: every Live employee is mirrored in the
--   old people table, which the Message Center still reads. Nothing is deleted.
-- • A person can be added to, or taken off, a payroll run while it is a draft.

alter table public.employees add column if not exists phone text;
alter table public.employees add column if not exists email text;
update public.employees e set phone = p.phone, email = p.email
  from public.people p where p.id = e.legacy_person_id and e.phone is null and e.email is null;

create or replace function public.mirror_employee_to_person() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid := new.legacy_person_id;
begin
  if new.book <> 'live' then return new; end if;
  if pid is not null and exists (select 1 from public.people where id = pid) then
    update public.people set name = new.name, title = new.job_title, phone = new.phone, email = new.email,
      active = new.active, joined_on = new.start_date, updated_at = now()
    where id = pid;
  else
    insert into public.people (name, role, title, phone, email, active, joined_on)
    values (new.name, 'employee', new.job_title, new.phone, new.email, new.active, new.start_date)
    returning id into pid;
    new.legacy_person_id := pid;
  end if;
  return new;
end $$;
create trigger employees_mirror_person before insert or update on public.employees
  for each row execute function public.mirror_employee_to_person();

/** Add an employee to a draft run, pre-filled the way the run itself does it. */
create or replace function public.rpc_add_payslip(p_run uuid, p_employee uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.payroll_runs; e public.employees; v_slip uuid; v_alloc date; month_end date;
begin
  perform public.require_role('payroll');
  select * into r from public.payroll_runs where id = p_run for update;
  perform public._require_book(r.book);
  if r.status not in ('draft', 'review') then raise exception 'This payroll run is approved; it can no longer change'; end if;
  select * into e from public.employees where id = p_employee and book = r.book;
  if not found then raise exception 'No such employee'; end if;
  if exists (select 1 from public.payslips where run_id = p_run and employee_id = p_employee) then raise exception '% is already in this run', e.name; end if;
  month_end := (r.period_month + interval '1 month - 1 day')::date;
  insert into public.payslips (run_id, employee_id) values (p_run, p_employee) returning id into v_slip;
  insert into public.payslip_lines (payslip_id, pay_item_id, amount)
    select v_slip, id, e.basic_salary from public.pay_items where code = 'BASIC' and e.basic_salary > 0;
  insert into public.payslip_lines (payslip_id, pay_item_id, amount)
    select v_slip, pay_item_id, amount from public.employee_pay_items where employee_id = e.id;
  select max(effective_from) into v_alloc from public.employee_allocations where employee_id = e.id and effective_from <= month_end;
  insert into public.labour_allocations (payslip_id, project_id, quantity)
    select v_slip, project_id, percent from public.employee_allocations where employee_id = e.id and effective_from = v_alloc;
  if not exists (select 1 from public.labour_allocations where payslip_id = v_slip) then
    insert into public.labour_allocations (payslip_id, project_id, quantity) values (v_slip, null, 100);
  end if;
  perform public.calc_payslip(v_slip);
  return v_slip;
end $$;

create or replace function public.rpc_remove_payslip(p_payslip uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.payroll_runs;
begin
  perform public.require_role('payroll');
  select pr.* into r from public.payroll_runs pr join public.payslips s on s.run_id = pr.id where s.id = p_payslip;
  perform public._require_book(r.book);
  if r.status not in ('draft', 'review') then raise exception 'This payroll run is approved; it can no longer change'; end if;
  delete from public.payslips where id = p_payslip;
end $$;

revoke execute on function public.mirror_employee_to_person() from public, anon, authenticated;
revoke execute on function public.rpc_add_payslip(uuid, uuid) from public, anon;
revoke execute on function public.rpc_remove_payslip(uuid) from public, anon;
grant execute on function public.rpc_add_payslip(uuid, uuid) to authenticated;
grant execute on function public.rpc_remove_payslip(uuid) to authenticated;
