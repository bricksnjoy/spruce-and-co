-- One-time reset of the live database (27 Oct 2026, at the owner's request: all
-- data so far was test data). Keeps the logins, every setting and the four
-- directors; deletes everything else so the real records can be entered. Run in
-- one transaction by .github/workflows/db-reset.yml; if anything fails, or the
-- Health Check finds a problem at the end, nothing is changed.
--
-- Kept: profiles (logins), settings, company, chart of accounts (less the
-- sub-accounts of deleted contacts), currencies, exchange rates, rates, tax
-- codes, cost categories, pay items, document templates, signatories, the
-- estimator's materials, parts and settings, gazette settings, the profit-share
-- scheme, the four directors (Capital Pool members, employees and the older people
-- and Capital Pool lists) and the signature and stamp images. Document numbers start
-- again from 1. Everything is first copied to the schema backup_20261027.

set client_min_messages = warning;

do $$
declare
  keep text[] := array['profiles', 'settings', 'company', 'accounts', 'contacts', 'currencies', 'exchange_rates', 'rates',
    'tax_codes', 'cost_categories', 'pay_items', 'document_templates', 'signatories', 'estimator_settings', 'gazette_settings',
    'cabinet_parts', 'cabinet_materials', 'profit_schemes', 'scheme_allocations', 'profit_shares', 'capital_pool_members',
    'people', 'employees', 'employee_pay_items', 'document_sequences', 'financial_years', 'saved_reports'];
  t text; todo text[]; stuck text[]; pass int;
begin
  -- 1 · a full copy first
  create schema backup_20261027;
  revoke all on schema backup_20261027 from public;
  for t in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' loop
    execute format('create table backup_20261027.%I as table public.%I', t, t);
  end loop;

  -- 2 · the guards (posted documents, filed returns, closed projects) and the change log stay out of the way
  for t in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  -- 3 · every other table emptied, in whatever order the foreign keys allow
  select array_agg(table_name::text) into todo from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE' and not (table_name::text = any (keep));
  for pass in 1..30 loop
    exit when coalesce(cardinality(todo), 0) = 0;
    stuck := '{}';
    foreach t in array todo loop
      begin
        execute format('delete from public.%I where true', t);
      exception when foreign_key_violation then
        stuck := stuck || t;
      end;
    end loop;
    if cardinality(stuck) = cardinality(todo) then raise exception 'Could not empty: %', stuck; end if;
    todo := stuck;
  end loop;

  -- 4 · of the contacts, only the directors stay (Capital Pool members, on the payroll or in the profit split), with their own sub-accounts
  create temp table _kept_contacts on commit drop as
    select id from public.contacts where 'partner' = any (kinds)
    union select contact_id from public.employees where contact_id is not null
    union select contact_id from public.scheme_allocations where contact_id is not null;
  delete from public.accounts a where a.contact_id is not null and a.contact_id not in (select id from _kept_contacts);
  delete from public.contacts where id not in (select id from _kept_contacts);

  -- 5 · numbering starts again
  update public.document_sequences set next_number = 1 where true;

  for t in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  -- 6 · the receipt photos go; the signatures and stamp stay
  begin
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects where bucket_id = 'bills';
  exception when others then
    raise warning 'Receipt photos were left in storage: %', sqlerrm;
  end;

  -- 7 · the books must still be sound
  if exists (select 1 from public.health_check('live') where not ok) then
    raise exception 'The Health Check failed after the reset; nothing was changed: %',
      (select string_agg(no || ' ' || name || ': ' || detail, '; ') from public.health_check('live') where not ok);
  end if;
  raise notice 'Reset done. Left: % contacts, % employees, % accounts, % transactions, % projects',
    (select count(*) from public.contacts), (select count(*) from public.employees), (select count(*) from public.accounts),
    (select count(*) from public.transactions), (select count(*) from public.projects);
end $$;
