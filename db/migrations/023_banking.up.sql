-- 023 · Banking (Phase 4, module 7; the "010" of the architecture plan).
-- • Statement lines imported from CSV, each matched to a ledger line, added as
--   a new transaction, or excluded. A statement line matches one ledger line,
--   and one ledger line is matched once.
-- • Bank rules suggest what to add a line as.
-- • Reconciliation: enter the statement's ending balance, tick cleared lines;
--   it completes only when the difference is 0; only the latest can be undone.
--   Reconciled lines cannot be changed or voided until it is undone.
-- • Marking lines cleared is not a change to the books, so it is allowed in a
--   closed period or a filed GST return; so is banking an old receipt or
--   closing an old purchase order.

create table public.bank_imports (
  id uuid primary key default gen_random_uuid(),
  book text not null default public.current_book() check (book in ('live', 'sandbox')),
  account_id uuid not null references public.accounts,
  file_name text,
  line_count int not null default 0,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  book text not null default public.current_book() check (book in ('live', 'sandbox')),
  import_id uuid references public.bank_imports on delete set null,
  account_id uuid not null references public.accounts,
  date date not null,
  description text not null default '',
  amount numeric(18,2) not null,             -- money in positive, out negative, in the account's currency
  balance numeric(18,2),
  fingerprint text not null,
  status text not null default 'open' check (status in ('open', 'matched', 'added', 'excluded')),
  journal_line_id bigint references public.journal_lines on delete set null,
  transaction_id uuid references public.transactions,
  created_at timestamptz not null default now(),
  unique (book, account_id, fingerprint)
);
create unique index bank_statement_lines_one_match on public.bank_statement_lines (journal_line_id) where journal_line_id is not null;
create index bank_statement_lines_open on public.bank_statement_lines (account_id, status, date);

create table public.bank_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  priority int not null default 100,
  contains text,                              -- description contains (any case)
  direction text not null default 'any' check (direction in ('in', 'out', 'any')),
  min_amount numeric(18,2),
  max_amount numeric(18,2),
  account_id uuid not null references public.accounts,
  contact_id uuid references public.contacts,
  project_id uuid references public.projects,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  book text not null default public.current_book() check (book in ('live', 'sandbox')),
  account_id uuid not null references public.accounts,
  statement_date date not null,
  ending_balance numeric(18,2) not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'undone')),
  completed_at timestamptz,
  completed_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index reconciliations_one_open on public.reconciliations (book, account_id) where status = 'in_progress';
alter table public.journal_lines add constraint journal_lines_reconciliation_fk foreign key (reconciliation_id) references public.reconciliations;

-- ── what counts as a change to the books ─────────────────────────────────
create or replace function public.guard_closing_date() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare cd date := (select closing_date from public.settings where id);
begin
  if tg_op = 'DELETE' and public._purging() and old.book = 'sandbox' then return old; end if;
  if cd is null then return coalesce(new, old); end if;
  -- marking sent, banking a receipt, closing an order, or ticking a line cleared changes no figures
  if tg_op = 'UPDATE' and tg_table_name = 'transactions'
     and (to_jsonb(new) - array['sent_at', 'updated_at', 'deposited_in', 'closed_at']) = (to_jsonb(old) - array['sent_at', 'updated_at', 'deposited_in', 'closed_at']) then
    return new;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'journal_lines'
     and (to_jsonb(new) - array['cleared', 'reconciliation_id']) = (to_jsonb(old) - array['cleared', 'reconciliation_id']) then
    return new;
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
  if tg_op = 'UPDATE' and (to_jsonb(new) - array['cleared', 'reconciliation_id']) = (to_jsonb(old) - array['cleared', 'reconciliation_id']) then
    return new;
  end if;
  if public._line_frozen(old.tax_period_id) then
    raise exception 'That GST return is filed; its lines cannot change. Corrections go into the next open return.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

/** A reconciled line stays as it is until its reconciliation is undone. */
create or replace function public.guard_reconciled() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if public._purging() then return old; end if;
  if old.cleared = 'reconciled' then
    raise exception 'That is part of a completed bank reconciliation; undo the reconciliation before changing or voiding it' using errcode = 'P0001';
  end if;
  -- a line that goes away is no longer matched to the statement
  update public.bank_statement_lines set status = 'open', journal_line_id = null, transaction_id = null
    where journal_line_id = old.id and status = 'matched';
  return old;
end $$;
create trigger journal_lines_reconciled before delete on public.journal_lines
  for each row execute function public.guard_reconciled();

-- ── helpers ──────────────────────────────────────────────────────────────
create or replace function public._bank_account(p_account uuid) returns public.accounts language plpgsql stable set search_path = public, pg_temp as $$
declare a public.accounts;
begin
  select * into a from public.accounts where id = p_account;
  if not found or a.subtype not in ('bank', 'cash', 'credit_card') then raise exception 'Choose a bank, cash or card account'; end if;
  return a;
end $$;

/** A ledger line on the account that no statement line has claimed, for the same amount, closest in date (within 10 days). */
create or replace function public._match_candidate(p_line public.bank_statement_lines) returns bigint language sql stable set search_path = public, pg_temp as $$
  select j.id from public.journal_lines j
  where j.account_id = p_line.account_id and j.book = p_line.book and j.debit - j.credit = p_line.amount
    and abs(j.date - p_line.date) <= 10
    and not exists (select 1 from public.bank_statement_lines b where b.journal_line_id = j.id)
  order by abs(j.date - p_line.date), j.id
  limit 1
$$;

-- ── the doors the screens use ────────────────────────────────────────────
/** Import statement lines (already read from the CSV); duplicates are skipped; each is matched if a single obvious ledger line exists. */
create or replace function public.rpc_import_statement(p_account uuid, p_file text, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_import uuid; l record; v_line public.bank_statement_lines; added int := 0; dup int := 0; matched int := 0; cand bigint;
begin
  perform public.require_role('write');
  perform public._bank_account(p_account);
  insert into public.bank_imports (account_id, file_name) values (p_account, p_file) returning id into v_import;
  for l in select (x ->> 'date')::date d, coalesce(x ->> 'description', '') descr, (x ->> 'amount')::numeric amt,
                  nullif(x ->> 'balance', '')::numeric bal, x ->> 'fingerprint' fp
           from jsonb_array_elements(p_lines) x order by 1 loop
    if l.amt is null or l.amt = 0 or l.d is null or l.fp is null then continue; end if;
    insert into public.bank_statement_lines (import_id, account_id, date, description, amount, balance, fingerprint)
    values (v_import, p_account, l.d, l.descr, round(l.amt, 2), round(l.bal, 2), l.fp)
    on conflict (book, account_id, fingerprint) do nothing
    returning * into v_line;
    if not found then dup := dup + 1; continue; end if;
    added := added + 1;
    cand := public._match_candidate(v_line);
    if cand is not null then
      update public.bank_statement_lines set status = 'matched', journal_line_id = cand,
        transaction_id = (select transaction_id from public.journal_lines where id = cand) where id = v_line.id;
      matched := matched + 1;
    end if;
  end loop;
  update public.bank_imports set line_count = added where id = v_import;
  return jsonb_build_object('added', added, 'duplicates', dup, 'matched', matched);
end $$;

create or replace function public.rpc_match_line(p_line uuid, p_journal_line bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bank_statement_lines; j public.journal_lines;
begin
  perform public.require_role('write');
  select * into b from public.bank_statement_lines where id = p_line for update;
  perform public._require_book(b.book);
  select * into j from public.journal_lines where id = p_journal_line;
  if j.account_id <> b.account_id or j.book <> b.book then raise exception 'That ledger line is on another account'; end if;
  if j.debit - j.credit <> b.amount then raise exception 'The amounts differ (% on the statement, % in the books)', b.amount, j.debit - j.credit; end if;
  update public.bank_statement_lines set status = 'matched', journal_line_id = p_journal_line, transaction_id = j.transaction_id where id = p_line;
end $$;

create or replace function public.rpc_unmatch_line(p_line uuid, p_status text default 'open') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bank_statement_lines;
begin
  perform public.require_role('write');
  select * into b from public.bank_statement_lines where id = p_line for update;
  perform public._require_book(b.book);
  if p_status not in ('open', 'excluded') then raise exception 'Unknown status'; end if;
  if b.status = 'added' then raise exception 'This line was added as a transaction; void that transaction instead'; end if;
  update public.bank_statement_lines set status = p_status, journal_line_id = null, transaction_id = null where id = p_line;
end $$;

/**
 * Add a statement line to the books: money out as an expense, money in as a
 * journal (bank against the chosen account). It is matched to what it creates.
 */
create or replace function public.rpc_add_from_line(p_line uuid, p_account uuid, p_contact uuid default null, p_project uuid default null, p_memo text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bank_statement_lines; bank public.accounts; v_id uuid; v_jl bigint;
begin
  perform public.require_role('write');
  select * into b from public.bank_statement_lines where id = p_line for update;
  perform public._require_book(b.book);
  if b.status <> 'open' then raise exception 'This line is already dealt with'; end if;
  bank := public._bank_account(b.account_id);
  if p_account is null or p_account = b.account_id then raise exception 'Choose what it was for'; end if;
  if b.amount < 0 then
    insert into public.transactions (type, date, contact_id, project_id, bank_account_id, memo, reference, currency, fx_rate, book)
    values ('expense', b.date, p_contact, p_project, b.account_id, coalesce(p_memo, b.description), 'Bank statement', bank.currency,
      case when bank.currency = 'MVR' then 1 else coalesce((select rate from public.exchange_rates where currency = bank.currency and rate_date <= b.date order by rate_date desc limit 1), 1) end, b.book)
    returning id into v_id;
    insert into public.transaction_lines (transaction_id, line_no, account_id, description, amount, project_id)
    values (v_id, 1, p_account, coalesce(p_memo, b.description), -b.amount, p_project);
  else
    insert into public.transactions (type, date, contact_id, project_id, memo, reference, currency, fx_rate, number, book)
    values ('journal', b.date, p_contact, p_project, coalesce(p_memo, b.description), 'Bank statement', bank.currency,
      case when bank.currency = 'MVR' then 1 else coalesce((select rate from public.exchange_rates where currency = bank.currency and rate_date <= b.date order by rate_date desc limit 1), 1) end,
      public.next_doc_number('journal', b.date), b.book)
    returning id into v_id;
    insert into public.transaction_lines (transaction_id, line_no, account_id, description, debit, project_id) values (v_id, 1, b.account_id, b.description, b.amount, p_project);
    insert into public.transaction_lines (transaction_id, line_no, account_id, description, credit, contact_id, project_id) values (v_id, 2, p_account, b.description, b.amount, p_contact, p_project);
  end if;
  perform public.post_transaction(v_id);
  select id into v_jl from public.journal_lines where transaction_id = v_id and account_id = b.account_id and debit - credit = b.amount limit 1;
  update public.bank_statement_lines set status = 'added', journal_line_id = v_jl, transaction_id = v_id where id = p_line;
  return v_id;
end $$;

/** The rule that fits a statement line best, if any. */
create or replace function public.bank_rule_for(p_line uuid) returns uuid language sql stable set search_path = public, pg_temp as $$
  select r.id from public.bank_rules r, public.bank_statement_lines b
  where b.id = p_line and r.active
    and (r.contains is null or b.description ilike '%' || r.contains || '%')
    and (r.direction = 'any' or (r.direction = 'in' and b.amount > 0) or (r.direction = 'out' and b.amount < 0))
    and (r.min_amount is null or abs(b.amount) >= r.min_amount) and (r.max_amount is null or abs(b.amount) <= r.max_amount)
  order by r.priority, r.created_at limit 1
$$;

/** Start reconciling an account against a statement. */
create or replace function public.rpc_start_reconciliation(p_account uuid, p_date date, p_ending numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.require_role('write');
  perform public._bank_account(p_account);
  if exists (select 1 from public.reconciliations where account_id = p_account and book = public.current_book() and status = 'completed' and statement_date >= p_date) then
    raise exception 'This account is already reconciled to a later statement';
  end if;
  insert into public.reconciliations (account_id, statement_date, ending_balance) values (p_account, p_date, p_ending) returning id into v_id;
  return v_id;
end $$;

/** Tick or untick lines as cleared in the reconciliation in progress. */
create or replace function public.rpc_set_cleared(p_recon uuid, p_lines bigint[], p_cleared boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.reconciliations;
begin
  perform public.require_role('write');
  select * into r from public.reconciliations where id = p_recon;
  perform public._require_book(r.book);
  if r.status <> 'in_progress' then raise exception 'This reconciliation is finished'; end if;
  update public.journal_lines set cleared = case when p_cleared then 'cleared' else 'uncleared' end,
    reconciliation_id = case when p_cleared then p_recon end
  where id = any (p_lines) and account_id = r.account_id and book = r.book and cleared <> 'reconciled' and date <= r.statement_date;
end $$;

/** The reconciliation's figures: the cleared balance and the difference still to find. */
create or replace function public.reconciliation_status(p_recon uuid, out cleared_balance numeric, out difference numeric) language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(j.debit - j.credit), 0), r.ending_balance - coalesce(sum(j.debit - j.credit), 0)
  from public.reconciliations r
  left join public.journal_lines j on j.account_id = r.account_id and j.book = r.book
    and (j.cleared = 'reconciled' or (j.cleared = 'cleared' and j.reconciliation_id = r.id))
  where r.id = p_recon
  group by r.ending_balance
$$;

create or replace function public.rpc_finish_reconciliation(p_recon uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.reconciliations; d numeric;
begin
  perform public.require_role('write');
  select * into r from public.reconciliations where id = p_recon for update;
  perform public._require_book(r.book);
  if r.status <> 'in_progress' then raise exception 'This reconciliation is already finished'; end if;
  d := (public.reconciliation_status(p_recon)).difference;
  if d <> 0 then raise exception 'The difference is % — it must be 0 before the reconciliation can be finished', d; end if;
  update public.journal_lines set cleared = 'reconciled' where reconciliation_id = p_recon and cleared = 'cleared';
  update public.reconciliations set status = 'completed', completed_at = now(), completed_by = auth.uid() where id = p_recon;
end $$;

/** Undo the latest completed reconciliation of an account (or abandon one in progress). */
create or replace function public.rpc_undo_reconciliation(p_recon uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.reconciliations;
begin
  perform public.require_role('write');
  select * into r from public.reconciliations where id = p_recon for update;
  perform public._require_book(r.book);
  if r.status = 'undone' then raise exception 'Already undone'; end if;
  if r.status = 'completed' and exists (select 1 from public.reconciliations where account_id = r.account_id and book = r.book
      and status in ('completed', 'in_progress') and id <> r.id and statement_date > r.statement_date) then
    raise exception 'Only the latest reconciliation can be undone';
  end if;
  update public.journal_lines set cleared = 'uncleared', reconciliation_id = null where reconciliation_id = p_recon;
  update public.reconciliations set status = 'undone' where id = p_recon;
end $$;

-- ── security ─────────────────────────────────────────────────────────────
alter table public.bank_imports enable row level security;
alter table public.bank_statement_lines enable row level security;
alter table public.bank_rules enable row level security;
alter table public.reconciliations enable row level security;
revoke all on public.bank_imports, public.bank_statement_lines, public.reconciliations from anon;
revoke insert, update, delete, truncate on public.bank_imports, public.bank_statement_lines, public.reconciliations from authenticated;
revoke all on public.bank_rules from anon;
create policy bank_imports_read on public.bank_imports for select to authenticated using (public.is_staff() and book = public.current_book());
create policy bank_statement_lines_read on public.bank_statement_lines for select to authenticated using (public.is_staff() and book = public.current_book());
create policy reconciliations_read on public.reconciliations for select to authenticated using (public.is_staff() and book = public.current_book());
create policy bank_rules_read on public.bank_rules for select to authenticated using (public.is_staff());
create policy bank_rules_write on public.bank_rules for all to authenticated using (public.can_write()) with check (public.can_write());

-- the Test book's banking goes with it when it is reset
create or replace function public._purge_banking() returns void language sql set search_path = public, pg_temp as $$
  update public.journal_lines set reconciliation_id = null where book = 'sandbox';
  delete from public.bank_statement_lines where book = 'sandbox';
  delete from public.bank_imports where book = 'sandbox';
  delete from public.reconciliations where book = 'sandbox';
$$;

/** Wipe the Test book: every test document, contact, employee, project and number. Live is untouched. */
create or replace function public.rpc_reset_test_book() returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('admin');
  perform set_config('app.purging', 'on', true);
  perform public._purge_banking();
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

revoke execute on function public.guard_reconciled() from public, anon, authenticated;
revoke execute on function public._purge_banking() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['rpc_import_statement(uuid, text, jsonb)', 'rpc_match_line(uuid, bigint)', 'rpc_unmatch_line(uuid, text)',
    'rpc_add_from_line(uuid, uuid, uuid, uuid, text)', 'bank_rule_for(uuid)', 'rpc_start_reconciliation(uuid, date, numeric)',
    'rpc_set_cleared(uuid, bigint[], boolean)', 'reconciliation_status(uuid)', 'rpc_finish_reconciliation(uuid)', 'rpc_undo_reconciliation(uuid)'] loop
    execute 'revoke execute on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
