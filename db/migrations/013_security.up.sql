-- 013 · Security for the new books (§1, §7 access, audit A-06, A-07).
-- • Reads: staff see only the book they are working in; payroll only with payroll permission.
-- • Writes to the ledger go only through the rpc_* functions below, which check
--   the role and the book and post in the same transaction. Nobody writes
--   journal lines, transactions or applications directly.
-- • Test data (the Test book) can be wiped by an admin in one step.

-- ── who may do what ─────────────────────────────────────────────────────

create or replace function public.has_payroll() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and (role in ('admin', 'finance') or can_payroll))
$$;

create or replace function public.require_role(p_kind text) returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_kind = 'staff' and not public.is_staff() then raise exception 'Sign in to continue' using errcode = '42501'; end if;
  if p_kind = 'write' and not public.can_write() then raise exception 'You can view but not change the books' using errcode = '42501'; end if;
  if p_kind = 'admin' and not public.is_admin() then raise exception 'Only an admin can do this' using errcode = '42501'; end if;
  if p_kind = 'payroll' and not public.has_payroll() then raise exception 'You do not have payroll permission' using errcode = '42501'; end if;
end $$;

create or replace function public._require_book(p_book text) returns void language plpgsql stable as $$
begin
  if p_book is null then raise exception 'Not found'; end if;
  if p_book <> public.current_book() then
    raise exception 'That belongs to the other book (Live and Test are never mixed)' using errcode = 'P0001';
  end if;
end $$;

-- ── the ledger's front door ─────────────────────────────────────────────

create or replace function public._payroll_type(p txn_type) returns boolean language sql immutable as $$
  select p in ('payroll_run', 'salary_payment', 'payroll_remittance', 'staff_advance')
$$;

/**
 * Save a document and post it, in one transaction (§1 "post on save").
 * `p` is the document as JSON: header fields, `lines` and `applications`.
 */
create or replace function public.rpc_save_transaction(p jsonb) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid; v_type public.txn_type := (p ->> 'type')::public.txn_type; t public.transactions;
  l jsonb; a jsonb; i int := 0; v_date date := (p ->> 'date')::date;
begin
  if v_type in ('payroll_run', 'distribution', 'gst_settlement', 'gst_payment', 'wip_adjustment', 'fx_revaluation', 'depreciation') then
    raise exception 'That is created by its own screen, not saved directly';
  end if;
  perform public.require_role(case when public._payroll_type(v_type) then 'payroll' else 'write' end);
  if v_date is null then raise exception 'Enter the date'; end if;
  if v_id is not null then
    select * into t from public.transactions where id = v_id for update;
    perform public._require_book(t.book);
    if t.voided_at is not null then raise exception 'A void document cannot be changed'; end if;
    if t.type <> v_type then raise exception 'A document cannot change its type'; end if;
    update public.transactions set date = v_date, number = coalesce(nullif(p ->> 'number', ''), number),
      due_date = (p ->> 'due_date')::date, contact_id = (p ->> 'contact_id')::uuid, project_id = (p ->> 'project_id')::uuid,
      employee_id = (p ->> 'employee_id')::uuid, bank_account_id = (p ->> 'bank_account_id')::uuid, total_amount = (p ->> 'total_amount')::numeric,
      currency = coalesce(p ->> 'currency', 'MVR'), fx_rate = coalesce((p ->> 'fx_rate')::numeric, 1), memo = p ->> 'memo', reference = p ->> 'reference',
      terms_days = (p ->> 'terms_days')::int, supplier_tin = p ->> 'supplier_tin', tax_invoice_no = p ->> 'tax_invoice_no',
      tax_invoice_date = (p ->> 'tax_invoice_date')::date, customs_ref = p ->> 'customs_ref', is_draft = coalesce((p ->> 'is_draft')::boolean, false),
      updated_at = now()
    where id = v_id;
    delete from public.applications where from_transaction_id = v_id;
    delete from public.transaction_lines where transaction_id = v_id;
  else
    insert into public.transactions (type, date, number, due_date, contact_id, project_id, employee_id, bank_account_id, total_amount,
      currency, fx_rate, memo, reference, terms_days, supplier_tin, tax_invoice_no, tax_invoice_date, customs_ref, is_draft)
    values (v_type, v_date, coalesce(nullif(p ->> 'number', ''), public.next_doc_number(v_type::text, v_date)),
      (p ->> 'due_date')::date, (p ->> 'contact_id')::uuid, (p ->> 'project_id')::uuid, (p ->> 'employee_id')::uuid,
      (p ->> 'bank_account_id')::uuid, (p ->> 'total_amount')::numeric, coalesce(p ->> 'currency', 'MVR'), coalesce((p ->> 'fx_rate')::numeric, 1),
      p ->> 'memo', p ->> 'reference', (p ->> 'terms_days')::int, p ->> 'supplier_tin', p ->> 'tax_invoice_no',
      (p ->> 'tax_invoice_date')::date, p ->> 'customs_ref', coalesce((p ->> 'is_draft')::boolean, false))
    returning id into v_id;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    i := i + 1;
    insert into public.transaction_lines (transaction_id, line_no, item_id, account_id, description, qty, rate, amount, tax_code_id, tax_amount,
      gst_claimable, project_id, employee_id, contact_id, component, debit, credit)
    values (v_id, i, (l ->> 'item_id')::uuid, (l ->> 'account_id')::uuid, l ->> 'description', (l ->> 'qty')::numeric, (l ->> 'rate')::numeric,
      coalesce((l ->> 'amount')::numeric, 0), (l ->> 'tax_code_id')::uuid, coalesce((l ->> 'tax_amount')::numeric, 0),
      coalesce((l ->> 'gst_claimable')::boolean, false), (l ->> 'project_id')::uuid, (l ->> 'employee_id')::uuid, (l ->> 'contact_id')::uuid,
      l ->> 'component', coalesce((l ->> 'debit')::numeric, 0), coalesce((l ->> 'credit')::numeric, 0));
  end loop;
  for a in select * from jsonb_array_elements(coalesce(p -> 'applications', '[]')) loop
    insert into public.applications (from_transaction_id, to_transaction_id, amount) values (v_id, (a ->> 'to')::uuid, (a ->> 'amount')::numeric);
  end loop;
  perform public.post_transaction(v_id);
  return v_id;
end $$;

create or replace function public.rpc_void(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transactions;
begin
  select * into t from public.transactions where id = p_id;
  perform public._require_book(t.book);
  perform public.require_role(case when public._payroll_type(t.type) then 'payroll' else 'write' end);
  if t.type in ('distribution', 'gst_settlement', 'gst_payment', 'payroll_run', 'wip_adjustment') then
    raise exception 'This entry is made by the system; it is reversed from its own screen';
  end if;
  perform public.void_transaction(p_id, p_reason);
end $$;

create or replace function public.rpc_mark_sent(p_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  perform public._require_book((select book from public.transactions where id = p_id));
  update public.transactions set sent_at = coalesce(sent_at, now()) where id = p_id;
end $$;

create or replace function public.rpc_complete_project(p_project uuid, p_date date) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  perform public._require_book((select book from public.projects where id = p_project));
  return public.complete_project(p_project, p_date);
end $$;

create or replace function public.rpc_run_wip(p_period_end date) returns int language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  return public.run_wip(p_period_end);
end $$;

create or replace function public.rpc_file_gst(p_period uuid, p_reference text) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  perform public._require_book((select book from public.tax_periods where id = p_period));
  return public.file_gst_period(p_period, p_reference);
end $$;

create or replace function public.rpc_pay_gst(p_period uuid, p_bank uuid, p_date date, p_amount numeric default null) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  perform public._require_book((select book from public.tax_periods where id = p_period));
  return public.pay_gst_period(p_period, p_bank, p_date, p_amount);
end $$;

create or replace function public.rpc_gst_period(p_date date) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('staff');
  return public.gst_period_for(p_date, public.current_book());
end $$;

create or replace function public.rpc_create_payroll_run(p_month date, p_pay_date date) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('payroll');
  return public.create_payroll_run(p_month, p_pay_date);
end $$;

create or replace function public.rpc_calc_payslip(p_payslip uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('payroll');
  perform public._require_book((select r.book from public.payslips s join public.payroll_runs r on r.id = s.run_id where s.id = p_payslip));
  perform public.calc_payslip(p_payslip);
end $$;

create or replace function public.rpc_set_payroll_status(p_run uuid, p_status text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('payroll');
  perform public._require_book((select book from public.payroll_runs where id = p_run));
  perform public.set_payroll_status(p_run, p_status);
end $$;

/** Approving a payroll run posts it; it needs an admin (the MD's approval) with payroll permission. */
create or replace function public.rpc_approve_payroll_run(p_run uuid) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('payroll');
  perform public.require_role('admin');
  perform public._require_book((select book from public.payroll_runs where id = p_run));
  return public.approve_payroll_run(p_run);
end $$;

create or replace function public.rpc_pay_salaries(p_run uuid, p_bank uuid, p_date date) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('payroll');
  perform public._require_book((select book from public.payroll_runs where id = p_run));
  return public.pay_salaries(p_run, p_bank, p_date);
end $$;

/** The Health Check for the book you are in; it needs every line, payroll included, so it runs with full sight. */
create or replace function public.rpc_health_check() returns table (no int, name text, ok boolean, detail text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  return query select * from public.health_check(public.current_book());
end $$;

-- ── the two books ───────────────────────────────────────────────────────

create or replace function public.rpc_set_book(p_book text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('staff');
  if p_book not in ('live', 'sandbox') then raise exception 'Choose Live or Test'; end if;
  update public.profiles set active_book = p_book where id = auth.uid();
end $$;

/** Wipe the Test book: every test document, contact, employee, project and number. Live is untouched. */
create or replace function public.rpc_reset_test_book() returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('admin');
  perform set_config('app.purging', 'on', true);
  update public.tax_periods set settlement_transaction_id = null, payment_transaction_id = null where book = 'sandbox';
  update public.payroll_runs set journal_transaction_id = null where book = 'sandbox';
  update public.transactions set reverses_id = null, adjusts_id = null, tax_period_id = null where book = 'sandbox';
  update public.billing_stages set invoice_id = null where invoice_id in (select id from public.transactions where book = 'sandbox');
  delete from public.distributions where book = 'sandbox';
  delete from public.applications where book = 'sandbox';
  delete from public.advance_recoveries where employee_id in (select id from public.employees where book = 'sandbox');
  delete from public.payroll_runs where book = 'sandbox';
  delete from public.attachments where transaction_id in (select id from public.transactions where book = 'sandbox');
  delete from public.journal_lines where book = 'sandbox';
  delete from public.transactions where book = 'sandbox';
  delete from public.tax_periods where book = 'sandbox';
  delete from public.employee_allocations where project_id in (select id from public.projects where book = 'sandbox')
    or employee_id in (select id from public.employees where book = 'sandbox');
  delete from public.employees where book = 'sandbox';
  delete from public.accounts where book = 'sandbox';
  delete from public.projects where book = 'sandbox';
  delete from public.contacts where book = 'sandbox';
  update public.document_sequences set next_number = 1 where book = 'sandbox';
end $$;

-- ── row-level security ──────────────────────────────────────────────────

do $$
declare t text;
begin
  -- the ledger itself: read in your own book; never written directly
  foreach t in array array['transactions', 'journal_lines', 'applications', 'tax_periods', 'distributions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['transaction_lines', 'distribution_lines', 'document_sequences', 'payroll_runs', 'payslips'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  -- reference and working tables: RLS below decides
  foreach t in array array['settings', 'currencies', 'exchange_rates', 'rates', 'tax_codes', 'accounts', 'contacts', 'employees',
    'pay_items', 'employee_pay_items', 'employee_allocations', 'items', 'attachments', 'billing_stages', 'payslip_lines',
    'labour_allocations', 'advance_recoveries', 'profit_schemes', 'scheme_allocations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- payroll lines (an employee's pay) are visible only with payroll permission
create policy transactions_read on public.transactions for select to authenticated
  using (public.is_staff() and book = public.current_book() and (not public._payroll_type(type) or public.has_payroll()));
create policy journal_lines_read on public.journal_lines for select to authenticated
  using (public.is_staff() and book = public.current_book() and (employee_id is null or public.has_payroll()));
create policy transaction_lines_read on public.transaction_lines for select to authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_id and t.book = public.current_book()
    and (not public._payroll_type(t.type) or public.has_payroll())) and (employee_id is null or public.has_payroll()));
create policy applications_read on public.applications for select to authenticated using (public.is_staff() and book = public.current_book());
create policy tax_periods_read on public.tax_periods for select to authenticated using (public.is_staff() and book = public.current_book());
create policy distributions_read on public.distributions for select to authenticated using (public.is_staff() and book = public.current_book());
create policy distribution_lines_read on public.distribution_lines for select to authenticated
  using (exists (select 1 from public.distributions d where d.id = distribution_id and d.book = public.current_book()) and public.is_staff());
create policy document_sequences_read on public.document_sequences for select to authenticated using (public.is_staff());

create policy settings_read on public.settings for select to authenticated using (public.is_staff());
create policy settings_write on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy currencies_read on public.currencies for select to authenticated using (public.is_staff());
create policy currencies_write on public.currencies for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy exchange_rates_read on public.exchange_rates for select to authenticated using (public.is_staff());
create policy exchange_rates_write on public.exchange_rates for all to authenticated using (public.can_write()) with check (public.can_write());
create policy rates_read on public.rates for select to authenticated using (public.is_staff());
create policy rates_write on public.rates for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tax_codes_read on public.tax_codes for select to authenticated using (public.is_staff());
create policy tax_codes_write on public.tax_codes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy items_read on public.items for select to authenticated using (public.is_staff());
create policy items_write on public.items for all to authenticated using (public.can_write()) with check (public.can_write());
create policy profit_schemes_read on public.profit_schemes for select to authenticated using (public.is_staff());
create policy profit_schemes_write on public.profit_schemes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy scheme_allocations_read on public.scheme_allocations for select to authenticated using (public.is_staff());
create policy scheme_allocations_write on public.scheme_allocations for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy accounts_read on public.accounts for select to authenticated using (public.is_staff() and (book is null or book = public.current_book()));
create policy accounts_ins on public.accounts for insert to authenticated with check (public.can_write() and (book is null or book = public.current_book()));
create policy accounts_upd on public.accounts for update to authenticated using (public.can_write() and (book is null or book = public.current_book()));
create policy accounts_del on public.accounts for delete to authenticated using (public.is_admin() and (book is null or book = public.current_book()));

create policy contacts_read on public.contacts for select to authenticated using (public.is_staff() and book = public.current_book());
create policy contacts_ins on public.contacts for insert to authenticated with check (public.can_write() and book = public.current_book());
create policy contacts_upd on public.contacts for update to authenticated using (public.can_write() and book = public.current_book()) with check (book = public.current_book());
create policy contacts_del on public.contacts for delete to authenticated using (public.is_admin() and book = public.current_book());

create policy attachments_read on public.attachments for select to authenticated using (public.is_staff());
create policy attachments_ins on public.attachments for insert to authenticated with check (public.can_write());
create policy billing_stages_read on public.billing_stages for select to authenticated using (public.is_staff());
create policy billing_stages_write on public.billing_stages for all to authenticated using (public.can_write()) with check (public.can_write());

-- payroll: only admin, finance or someone given payroll permission
create policy employees_all on public.employees for all to authenticated
  using (public.has_payroll() and book = public.current_book()) with check (public.has_payroll() and book = public.current_book());
create policy employee_pay_items_all on public.employee_pay_items for all to authenticated
  using (public.has_payroll() and exists (select 1 from public.employees e where e.id = employee_id and e.book = public.current_book()))
  with check (public.has_payroll());
create policy employee_allocations_all on public.employee_allocations for all to authenticated
  using (public.has_payroll() and exists (select 1 from public.employees e where e.id = employee_id and e.book = public.current_book()))
  with check (public.has_payroll());
create policy advance_recoveries_all on public.advance_recoveries for all to authenticated
  using (public.has_payroll() and exists (select 1 from public.employees e where e.id = employee_id and e.book = public.current_book()))
  with check (public.has_payroll());
create policy pay_items_read on public.pay_items for select to authenticated using (public.is_staff());
create policy pay_items_write on public.pay_items for all to authenticated using (public.has_payroll() and public.is_admin()) with check (public.has_payroll() and public.is_admin());
create policy payroll_runs_read on public.payroll_runs for select to authenticated using (public.has_payroll() and book = public.current_book());
create policy payslips_read on public.payslips for select to authenticated
  using (public.has_payroll() and exists (select 1 from public.payroll_runs r where r.id = run_id and r.book = public.current_book()));
create policy payslip_lines_all on public.payslip_lines for all to authenticated
  using (public.has_payroll() and exists (select 1 from public.payslips s join public.payroll_runs r on r.id = s.run_id where s.id = payslip_id and r.book = public.current_book()))
  with check (public.has_payroll());
create policy labour_allocations_all on public.labour_allocations for all to authenticated
  using (public.has_payroll() and exists (select 1 from public.payslips s join public.payroll_runs r on r.id = s.run_id where s.id = payslip_id and r.book = public.current_book()))
  with check (public.has_payroll());

-- projects (an existing table) are read and changed only in the book you are working in
drop policy if exists projects_read on public.projects;
drop policy if exists projects_ins on public.projects;
drop policy if exists projects_upd on public.projects;
drop policy if exists projects_del on public.projects;
create policy projects_read on public.projects for select using (public.is_staff() and book = public.current_book());
create policy projects_ins on public.projects for insert with check (public.can_write() and book = public.current_book());
create policy projects_upd on public.projects for update using (public.can_write() and book = public.current_book()) with check (book = public.current_book());
create policy projects_del on public.projects for delete using (public.is_admin() and book = public.current_book());

-- views read through the caller's own permissions
alter view public.document_balances_v set (security_invoker = on);
alter view public.project_value_v set (security_invoker = on);
alter view public.payroll_runs_v set (security_invoker = on);
alter view public.gst_periods_v set (security_invoker = on);
alter view public.project_financing_v set (security_invoker = on);
alter view public.partner_statement_v set (security_invoker = on);

-- ── functions: the rpc_* doors and the read helpers are open; the machinery is not ──

do $$
declare f text;
begin
  foreach f in array array[
    'post_transaction(uuid)', 'void_transaction(uuid, text)', '_post_rules(public.transactions)', '_jl(public.transactions, uuid, numeric, uuid, uuid, uuid, text, text, uuid)',
    '_split(public.transactions, uuid, numeric, uuid, uuid)', '_fx_balance(public.transactions)', '_recalc_lines(public.transactions)',
    '_gst_after_post(uuid)', '_after_post(uuid, uuid[])', '_payout_gate(public.transactions)', 'next_doc_number(text, date)',
    'sub_account(text, uuid)', 'complete_project(uuid, date)', 'adjust_distribution(uuid, text, date)', '_post_distribution(uuid, date)',
    'run_wip(date)', 'file_gst_period(uuid, text)', 'pay_gst_period(uuid, uuid, date, numeric)', 'gst_period_for(date, text)',
    'create_payroll_run(date, date)', 'calc_payslip(uuid)', 'set_payroll_status(uuid, text)', 'approve_payroll_run(uuid)',
    'pay_salaries(uuid, uuid, date)'] loop
    execute 'revoke execute on function public.' || f || ' from public, anon, authenticated';
  end loop;
  -- every rpc_ door is for signed-in users only
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'rpc\_%' loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
