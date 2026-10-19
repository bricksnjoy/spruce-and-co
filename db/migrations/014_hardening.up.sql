-- 014 · Hardening from the Supabase advisor after going live:
-- • every function added in 001–013 runs with a fixed search_path, so a
--   caller's own schema can never change what a name points to;
-- • the permission helpers are for signed-in users only.

do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proconfig is null and p.proname = any (array[
      'current_book', '_purging', 'rate_value', 'rate_brackets', 'bracket_tax', 'tax_rate', 'next_doc_number',
      'acct', 'sub_account', 'guard_account', 'check_allocation_total', 'today_mv', 'doc_total', '_jl', '_split',
      '_money_account', '_check_claim', '_line_frozen', '_gst_after_post', '_after_post', '_payout_gate', '_recalc_lines',
      '_post_rules', '_fx_balance', 'post_transaction', 'void_transaction', 'check_balanced', 'guard_closing_date',
      'guard_lines_closing', 'guard_txn_delete', 'guard_claimable', 'check_application', 'document_status', 'guard_book',
      'number_variation', 'client_balance', 'project_profit', 'project_figures', 'project_stage', 'run_wip',
      'guard_run_editable', 'staff_advance_balance', '_alloc', 'calc_payslip', 'create_payroll_run', 'set_payroll_status',
      'approve_payroll_run', 'pay_salaries', 'gst_period_for', 'guard_filed_gst', 'gst_totals', 'gst_payable',
      'file_gst_period', 'pay_gst_period', 'check_scheme_total', 'scheme_on', 'set_project_scheme', 'split_profit',
      'preview_split', '_post_distribution', 'complete_project', 'adjust_distribution', 'payout_status',
      'stamp_closing_date', 'health_check', '_require_book', '_payroll_type'])
  loop
    execute 'alter function ' || f || ' set search_path = public, pg_temp';
  end loop;
end $$;

revoke execute on function public.has_payroll() from public, anon;
revoke execute on function public.require_role(text) from public, anon;
grant execute on function public.has_payroll() to authenticated;
grant execute on function public.require_role(text) to authenticated;
