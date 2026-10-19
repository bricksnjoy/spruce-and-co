-- undo 023: the banking tables and functions go; the guards and the Test reset go back to what they were
drop function if exists public.rpc_undo_reconciliation(uuid);
drop function if exists public.rpc_finish_reconciliation(uuid);
drop function if exists public.reconciliation_status(uuid);
drop function if exists public.rpc_set_cleared(uuid, bigint[], boolean);
drop function if exists public.rpc_start_reconciliation(uuid, date, numeric);
drop function if exists public.bank_rule_for(uuid);
drop function if exists public.rpc_add_from_line(uuid, uuid, uuid, uuid, text);
drop function if exists public.rpc_unmatch_line(uuid, text);
drop function if exists public.rpc_match_line(uuid, bigint);
drop function if exists public.rpc_import_statement(uuid, text, jsonb);
drop function if exists public._match_candidate(public.bank_statement_lines);
drop function if exists public._bank_account(uuid);
drop trigger if exists journal_lines_reconciled on public.journal_lines;
drop function if exists public.guard_reconciled();
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

drop function if exists public._purge_banking();
update public.journal_lines set cleared = 'uncleared', reconciliation_id = null where reconciliation_id is not null;
alter table public.journal_lines drop constraint if exists journal_lines_reconciliation_fk;
drop table if exists public.reconciliations;
drop table if exists public.bank_rules;
drop table if exists public.bank_statement_lines;
drop table if exists public.bank_imports;
create or replace function public.guard_closing_date() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare cd date := (select closing_date from public.settings where id);
begin
  if tg_op = 'DELETE' and public._purging() and old.book = 'sandbox' then return old; end if;
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

create or replace function public.guard_filed_gst() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and public._purging() and old.book = 'sandbox' then return old; end if;
  if public._line_frozen(old.tax_period_id) then
    raise exception 'That GST return is filed; its lines cannot change. Corrections go into the next open return.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
