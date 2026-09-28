-- put back the project policies as they were
drop policy if exists projects_read on public.projects;
drop policy if exists projects_ins on public.projects;
drop policy if exists projects_upd on public.projects;
drop policy if exists projects_del on public.projects;
create policy projects_read on public.projects for select using (public.is_staff());
create policy projects_ins on public.projects for insert with check (public.can_write());
create policy projects_upd on public.projects for update using (public.can_write());
create policy projects_del on public.projects for delete using (public.is_admin());

do $$
declare t text; pol record; f text;
begin
  foreach t in array array['transactions', 'journal_lines', 'applications', 'tax_periods', 'distributions', 'transaction_lines', 'distribution_lines',
    'document_sequences', 'payroll_runs', 'payslips', 'settings', 'currencies', 'exchange_rates', 'rates', 'tax_codes', 'accounts', 'contacts',
    'employees', 'pay_items', 'employee_pay_items', 'employee_allocations', 'items', 'attachments', 'billing_stages', 'payslip_lines',
    'labour_allocations', 'advance_recoveries', 'profit_schemes', 'scheme_allocations'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('alter table public.%I disable row level security', t);
    execute format('grant all on public.%I to anon, authenticated', t);
  end loop;
  foreach f in array array[
    'post_transaction(uuid)', 'void_transaction(uuid, text)', '_post_rules(public.transactions)', '_jl(public.transactions, uuid, numeric, uuid, uuid, uuid, text, text, uuid)',
    '_split(public.transactions, uuid, numeric, uuid, uuid)', '_fx_balance(public.transactions)', '_recalc_lines(public.transactions)',
    '_gst_after_post(uuid)', '_after_post(uuid, uuid[])', '_payout_gate(public.transactions)', 'next_doc_number(text, date)',
    'sub_account(text, uuid)', 'complete_project(uuid, date)', 'adjust_distribution(uuid, text, date)', '_post_distribution(uuid, date)',
    'run_wip(date)', 'file_gst_period(uuid, text)', 'pay_gst_period(uuid, uuid, date, numeric)', 'gst_period_for(date, text)',
    'create_payroll_run(date, date)', 'calc_payslip(uuid)', 'set_payroll_status(uuid, text)', 'approve_payroll_run(uuid)',
    'pay_salaries(uuid, uuid, date)'] loop
    execute 'grant execute on function public.' || f || ' to public';
  end loop;
end $$;

alter view public.document_balances_v reset (security_invoker);
alter view public.project_value_v reset (security_invoker);
alter view public.payroll_runs_v reset (security_invoker);
alter view public.gst_periods_v reset (security_invoker);
alter view public.project_financing_v reset (security_invoker);
alter view public.partner_statement_v reset (security_invoker);

drop function if exists public.rpc_health_check();
drop function if exists public.rpc_reset_test_book();
drop function if exists public.rpc_set_book(text);
drop function if exists public.rpc_pay_salaries(uuid, uuid, date);
drop function if exists public.rpc_approve_payroll_run(uuid);
drop function if exists public.rpc_set_payroll_status(uuid, text);
drop function if exists public.rpc_calc_payslip(uuid);
drop function if exists public.rpc_create_payroll_run(date, date);
drop function if exists public.rpc_gst_period(date);
drop function if exists public.rpc_pay_gst(uuid, uuid, date, numeric);
drop function if exists public.rpc_file_gst(uuid, text);
drop function if exists public.rpc_run_wip(date);
drop function if exists public.rpc_complete_project(uuid, date);
drop function if exists public.rpc_mark_sent(uuid);
drop function if exists public.rpc_void(uuid, text);
drop function if exists public.rpc_save_transaction(jsonb);
drop function if exists public._payroll_type(public.txn_type);
drop function if exists public._require_book(text);
drop function if exists public.require_role(text);
drop function if exists public.has_payroll();
