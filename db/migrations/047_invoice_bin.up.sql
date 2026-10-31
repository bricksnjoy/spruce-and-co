-- 047 · Deleting an invoice, credit note or sales receipt, with 30 days to
-- restore it, in the same bin as deleted bills. Deleting voids it, so it leaves
-- the books, the lists and the reports, and its billing stage is free to
-- invoice again. The customer's payments applied to it are kept as their
-- credit (the money was received), or, when asked, deleted with it if they
-- paid nothing else. Restoring puts it all back, its billing stage included.
alter table public.bill_bin add column stage_id uuid references public.billing_stages on delete set null;

create or replace function public.rpc_delete_sales_doc(p_id uuid, p_with_payments boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transactions; v_apps jsonb; v_pays uuid[] := '{}'; v_other text; v_stage uuid;
begin
  select * into t from public.transactions where id = p_id for update;
  if not found then raise exception 'No such invoice'; end if;
  perform public._require_book(t.book);
  perform public.require_role('write');
  if t.type not in ('invoice', 'credit_note', 'sales_receipt') then raise exception 'Only invoices, credit notes and sales receipts are deleted here'; end if;
  if t.voided_at is not null then raise exception 'This is already void or deleted'; end if;

  if p_with_payments then
    -- a payment that also paid other invoices is not undone here
    select string_agg(distinct coalesce(p.number, 'a payment'), ', ') into v_other
    from public.applications a join public.transactions p on p.id = a.from_transaction_id
    where a.to_transaction_id = p_id and p.voided_at is null and p.type = 'customer_payment'
      and exists (select 1 from public.applications o where o.from_transaction_id = p.id and o.to_transaction_id <> p_id);
    if v_other is not null then
      raise exception 'It was paid together with other invoices (%); void that payment first, or keep the payments', v_other;
    end if;
    select coalesce(array_agg(distinct a.from_transaction_id), '{}') into v_pays
    from public.applications a join public.transactions p on p.id = a.from_transaction_id
    where a.to_transaction_id = p_id and p.voided_at is null and p.type = 'customer_payment';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('from', a.from_transaction_id, 'to', a.to_transaction_id, 'amount', a.amount)), '[]') into v_apps
  from public.applications a
  join public.transactions f on f.id = a.from_transaction_id join public.transactions o on o.id = a.to_transaction_id
  where (a.to_transaction_id = p_id or a.from_transaction_id = p_id) and f.voided_at is null and o.voided_at is null;
  select id into v_stage from public.billing_stages where invoice_id = p_id;

  -- payments kept, credits and advances applied to it go back to being available
  delete from public.applications where to_transaction_id = p_id and not (from_transaction_id = any (v_pays));
  perform public.void_transaction(x, 'Deleted with ' || coalesce(t.number, 'its invoice')) from unnest(v_pays) x;
  perform public.void_transaction(p_id, 'Deleted');
  insert into public.bill_bin (bill_id, book, payments, applications, stage_id) values (p_id, t.book, v_pays, v_apps, v_stage);
end $$;

/** Put back a deleted bill or invoice within 30 days, with its payments, as it was. */
create or replace function public.rpc_restore_bill(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bill_bin; app jsonb; x uuid;
begin
  select * into b from public.bill_bin where bill_id = p_id for update;
  if not found then raise exception 'That document is not in the deleted ones'; end if;
  perform public._require_book(b.book);
  perform public.require_role('write');
  if b.deleted_at < now() - interval '30 days' then raise exception 'It was deleted over 30 days ago, so it can no longer be restored'; end if;

  update public.transactions set voided_at = null, void_reason = null, updated_at = now() where id = p_id or id = any (b.payments);
  -- an invoice goes back on its billing stage, unless the stage was invoiced again since
  if b.stage_id is not null then
    update public.billing_stages set invoice_id = p_id where id = b.stage_id and invoice_id is null;
    if not found then raise exception 'Its billing stage has been invoiced again since; delete that invoice first'; end if;
  end if;
  perform public.post_transaction(p_id);
  for app in select * from jsonb_array_elements(b.applications) loop
    insert into public.applications (from_transaction_id, to_transaction_id, amount)
    values ((app ->> 'from')::uuid, (app ->> 'to')::uuid, (app ->> 'amount')::numeric);
  end loop;
  -- post what was applied, so a credit used elsewhere meanwhile is caught
  for x in select distinct y from (select unnest(b.payments) y union select (a ->> 'from')::uuid from jsonb_array_elements(b.applications) a) z loop
    if x <> p_id then perform public.post_transaction(x); end if;
  end loop;
  perform public.post_transaction(p_id);
  delete from public.bill_bin where bill_id = p_id;
end $$;

revoke execute on function public.rpc_delete_sales_doc(uuid, boolean) from public, anon;
grant execute on function public.rpc_delete_sales_doc(uuid, boolean) to authenticated;
