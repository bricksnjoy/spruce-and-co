-- 021 · Expenses (Phase 4, module 5).
-- • Vendors and shops are one list: every Live vendor contact has a mirrored
--   row in the old vendors table (older screens still read it), kept in step.
-- • Bills above the approval limit (Settings) post only once an admin approves
--   them, and only up to the amount approved (feature: approval workflows).
-- • Pay several bills at once: one payment per vendor, all or nothing.
-- • A credit (vendor credit, credit note) can be applied to a bill or invoice later.
-- • A purchase order becomes a bill; open orders count as committed cost.

-- ── vendors = shops ──────────────────────────────────────────────────────
create or replace function public.mirror_contact_to_vendor() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare vid uuid := nullif(new.legacy ->> 'vendor_id', '')::uuid;
begin
  if public._mirroring() or new.book <> 'live' or not ('vendor' = any (new.kinds)) then return new; end if;
  perform set_config('app.mirroring', 'on', true);
  if vid is not null and exists (select 1 from public.vendors where id = vid) then
    update public.vendors set name = new.name, kind = coalesce(new.vendor_kind, 'supplier')::public.vendor_kind, trade = new.trade,
      contact_name = new.contact_person, email = new.email, phone = new.phone, address = new.address, tin = new.tin,
      bank_details = new.bank_details, licence_expiry = new.licence_expiry, insurance_expiry = new.insurance_expiry, notes = new.notes, updated_at = now()
    where id = vid;
  else
    insert into public.vendors (name, kind, trade, contact_name, email, phone, address, tin, bank_details, licence_expiry, insurance_expiry, notes)
    values (new.name, coalesce(new.vendor_kind, 'supplier')::public.vendor_kind, new.trade, new.contact_person, new.email, new.phone, new.address,
      new.tin, new.bank_details, new.licence_expiry, new.insurance_expiry, new.notes)
    returning id into vid;
    new.legacy := coalesce(new.legacy, '{}'::jsonb) || jsonb_build_object('vendor_id', vid);
  end if;
  perform set_config('app.mirroring', 'off', true);
  return new;
end $$;
create trigger contacts_mirror_vendor before insert or update on public.contacts
  for each row execute function public.mirror_contact_to_vendor();

create or replace function public.mirror_vendor_to_contact() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public._mirroring() then return new; end if;
  perform set_config('app.mirroring', 'on', true);
  update public.contacts set name = new.name, vendor_kind = new.kind::text, trade = new.trade, contact_person = new.contact_name,
    email = new.email, phone = new.phone, address = new.address, tin = coalesce(new.tin, new.tax_number), bank_details = new.bank_details,
    licence_expiry = new.licence_expiry, insurance_expiry = new.insurance_expiry, notes = new.notes, updated_at = now()
  where legacy ->> 'vendor_id' = new.id::text and book = 'live';
  if not found then
    insert into public.contacts (kinds, name, vendor_kind, trade, contact_person, email, phone, address, tin, bank_details,
      licence_expiry, insurance_expiry, notes, book, legacy)
    values (array['vendor'], new.name, new.kind::text, new.trade, new.contact_name, new.email, new.phone, new.address,
      coalesce(new.tin, new.tax_number), new.bank_details, new.licence_expiry, new.insurance_expiry, new.notes, 'live',
      jsonb_build_object('vendor_id', new.id));
  end if;
  perform set_config('app.mirroring', 'off', true);
  return new;
end $$;
create trigger vendors_mirror_contact after insert or update on public.vendors
  for each row execute function public.mirror_vendor_to_contact();

-- bring the copied vendors into step
update public.contacts set updated_at = updated_at where book = 'live' and 'vendor' = any (kinds);

-- ── bill approval ────────────────────────────────────────────────────────
alter table public.transactions add column if not exists approved_total numeric(18,2);
alter table public.transactions add column if not exists purchase_order_id uuid references public.transactions;
alter table public.transactions add column if not exists closed_at timestamptz;   -- a purchase order that is done with

/** A posted bill above the limit must be approved, for at least its current total. */
create or replace function public.check_bill_approval() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare t public.transactions; lim numeric; tot numeric;
begin
  select * into t from public.transactions where id = new.id;
  if t.type <> 'bill' or t.is_draft or t.voided_at is not null then return null; end if;
  lim := (select approval_limit_bill from public.settings where id);
  if lim is null then return null; end if;
  tot := public.doc_total(t.id) * t.fx_rate;
  if tot > lim and (t.approval_status <> 'approved' or tot > coalesce(t.approved_total, 0)) then
    raise exception 'This bill (MVR %) is over the approval limit of MVR % and needs an admin''s approval before it is posted',
      to_char(tot, 'FM999,999,999,990.00'), to_char(lim, 'FM999,999,999,990.00') using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger transactions_bill_approval after insert or update on public.transactions
  deferrable initially deferred for each row execute function public.check_bill_approval();

/** Send a draft bill for approval. */
create or replace function public.rpc_request_approval(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transactions;
begin
  perform public.require_role('write');
  select * into t from public.transactions where id = p_id for update;
  perform public._require_book(t.book);
  if t.type <> 'bill' or not t.is_draft then raise exception 'Only a draft bill is sent for approval'; end if;
  update public.transactions set approval_status = 'pending', updated_at = now() where id = p_id;
end $$;

/** An admin approves a bill for its current total and posts it. */
create or replace function public.rpc_approve_bill(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transactions;
begin
  perform public.require_role('admin');
  select * into t from public.transactions where id = p_id for update;
  perform public._require_book(t.book);
  if t.type <> 'bill' or t.voided_at is not null then raise exception 'Only a bill can be approved'; end if;
  update public.transactions set approval_status = 'approved', approved_by = auth.uid(), approved_at = now(),
    approved_total = public.doc_total(p_id) * fx_rate, is_draft = false, updated_at = now() where id = p_id;
  perform public.post_transaction(p_id);
end $$;

-- ── paying bills ─────────────────────────────────────────────────────────
/** Pay bills from one account: one payment per vendor, each applied to its bills. */
create or replace function public.pay_bills(p_bank uuid, p_date date, p_items jsonb, p_reference text default null) returns uuid[]
language plpgsql set search_path = public, pg_temp as $$
declare v record; b record; v_id uuid; ids uuid[] := '{}'; v_book text := public.current_book();
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Choose the bills to pay'; end if;
  for v in
    select t.contact_id, sum((i ->> 'amount')::numeric) total
    from jsonb_array_elements(p_items) i join public.transactions t on t.id = (i ->> 'bill')::uuid
    group by t.contact_id
  loop
    insert into public.transactions (type, date, contact_id, bank_account_id, total_amount, reference, number, book)
    values ('bill_payment', p_date, v.contact_id, p_bank, v.total, p_reference, public.next_doc_number('bill_payment', p_date), v_book)
    returning id into v_id;
    for b in select (i ->> 'bill')::uuid bill, (i ->> 'amount')::numeric amt from jsonb_array_elements(p_items) i
             join public.transactions t on t.id = (i ->> 'bill')::uuid where t.contact_id = v.contact_id loop
      if b.amt <= 0 then raise exception 'Each amount paid must be more than 0'; end if;
      if (select type from public.transactions where id = b.bill) <> 'bill' then raise exception 'Only bills can be paid here'; end if;
      insert into public.applications (from_transaction_id, to_transaction_id, amount) values (v_id, b.bill, b.amt);
    end loop;
    perform public.post_transaction(v_id);
    ids := ids || v_id;
  end loop;
  return ids;
end $$;

create or replace function public.rpc_pay_bills(p_bank uuid, p_date date, p_items jsonb, p_reference text default null) returns uuid[]
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  return public.pay_bills(p_bank, p_date, p_items, p_reference);
end $$;

/** Apply a credit (vendor credit to a bill, credit note to an invoice) after both are posted. */
create or replace function public.rpc_apply_credit(p_from uuid, p_to uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.transactions;
begin
  perform public.require_role('write');
  select * into f from public.transactions where id = p_from;
  perform public._require_book(f.book);
  if f.type not in ('vendor_credit', 'credit_note') then raise exception 'Only a credit can be applied this way'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount to apply'; end if;
  insert into public.applications (from_transaction_id, to_transaction_id, amount) values (p_from, p_to, p_amount)
  on conflict (from_transaction_id, to_transaction_id) do update set amount = public.applications.amount + excluded.amount;
end $$;

-- ── purchase orders ──────────────────────────────────────────────────────
/** Turn an open purchase order into a draft bill with the same lines; the order closes. */
create or replace function public.rpc_bill_from_po(p_po uuid, p_date date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare po public.transactions; v_id uuid;
begin
  perform public.require_role('write');
  select * into po from public.transactions where id = p_po for update;
  perform public._require_book(po.book);
  if po.type <> 'purchase_order' or po.voided_at is not null then raise exception 'That is not an open purchase order'; end if;
  if po.closed_at is not null then raise exception 'This purchase order is already billed or closed'; end if;
  insert into public.transactions (type, date, due_date, contact_id, project_id, currency, fx_rate, memo, reference, is_draft, purchase_order_id, book)
  values ('bill', p_date, p_date + coalesce((select terms_days from public.contacts where id = po.contact_id), 0), po.contact_id, po.project_id,
    po.currency, po.fx_rate, po.memo, po.number, true, po.id, po.book)
  returning id into v_id;
  insert into public.transaction_lines (transaction_id, line_no, account_id, description, qty, rate, amount, tax_code_id, tax_amount, project_id)
  select v_id, line_no, account_id, description, qty, rate, amount, tax_code_id, tax_amount, project_id
  from public.transaction_lines where transaction_id = po.id;
  update public.transactions set closed_at = now() where id = po.id;
  return v_id;
end $$;

create or replace function public.rpc_close_po(p_po uuid, p_open boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  perform public._require_book((select book from public.transactions where id = p_po and type = 'purchase_order'));
  update public.transactions set closed_at = case when p_open then null else now() end where id = p_po;
end $$;

/** Committed cost: open purchase orders, by project and budget category (before GST). */
create or replace view public.committed_cost_v with (security_invoker = on) as
select t.book, coalesce(l.project_id, t.project_id) as project_id, coalesce(a.budget_category, 'other') as budget_category,
  sum(round(l.amount * t.fx_rate, 2)) as committed
from public.transactions t
join public.transaction_lines l on l.transaction_id = t.id
left join public.accounts a on a.id = l.account_id
where t.type = 'purchase_order' and t.voided_at is null and t.closed_at is null and not t.is_draft
group by 1, 2, 3;

-- ── the expenses list ────────────────────────────────────────────────────
create or replace view public.expenses_list_v with (security_invoker = on) as
select b.id, b.book, b.type, b.number, b.date, b.due_date, b.total, b.applied, b.applied_from, b.balance,
  b.is_draft, b.voided_at, b.contact_id, c.name as vendor_name, b.project_id, p.code as project_code,
  case when t.type = 'purchase_order' then case when t.voided_at is not null then 'void' when t.closed_at is not null then 'closed' else 'open' end
       when t.type = 'bill' and t.is_draft and t.approval_status = 'pending' then 'awaiting_approval'
       else public.document_status(b.id) end as status,
  t.approval_status, t.memo, t.currency, t.reference, t.tax_invoice_no, t.purchase_order_id,
  c.licence_expiry, c.insurance_expiry
from public.document_balances_v b
join public.transactions t on t.id = b.id
left join public.contacts c on c.id = b.contact_id
left join public.projects p on p.id = b.project_id
where b.type in ('bill', 'vendor_credit', 'bill_payment', 'expense', 'purchase_order');

/** Money paid against bills since a date. */
create or replace function public.bills_paid_since(p_since date) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(a.amount), 0) from public.applications a
  join public.transactions f on f.id = a.from_transaction_id
  join public.transactions t on t.id = a.to_transaction_id
  where t.type = 'bill' and f.type = 'bill_payment' and f.voided_at is null and f.date >= p_since
$$;

revoke execute on function public.mirror_contact_to_vendor() from public, anon, authenticated;
revoke execute on function public.mirror_vendor_to_contact() from public, anon, authenticated;
revoke execute on function public.check_bill_approval() from public, anon, authenticated;
revoke execute on function public.pay_bills(uuid, date, jsonb, text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['rpc_request_approval(uuid)', 'rpc_approve_bill(uuid)', 'rpc_pay_bills(uuid, date, jsonb, text)',
    'rpc_apply_credit(uuid, uuid, numeric)', 'rpc_bill_from_po(uuid, date)', 'rpc_close_po(uuid, boolean)', 'bills_paid_since(date)'] loop
    execute 'revoke execute on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
revoke all on public.expenses_list_v from anon;
revoke all on public.committed_cost_v from anon;
