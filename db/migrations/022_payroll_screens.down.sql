drop function if exists public.rpc_remove_payslip(uuid);
drop function if exists public.rpc_add_payslip(uuid, uuid);
drop trigger if exists employees_mirror_person on public.employees;
drop function if exists public.mirror_employee_to_person();
alter table public.employees drop column if exists email;
alter table public.employees drop column if exists phone;
