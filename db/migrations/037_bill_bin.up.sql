-- 037 · Deleting a bill, expense or vendor credit, with 30 days to restore it.
-- Deleting voids the document and the payments made only for it, and keeps in
-- bill_bin what is needed to put them back: the payments voided with it and the
-- payments and credits that were applied to or from it. Restoring within 30 days
-- un-voids them, applies them again and posts them; after 30 days the bill stays
-- void (nothing is ever removed from the books) and leaves the bin.
create table public.bill_bin (
  bill_id uuid primary key references public.transactions on delete cascade,
  book text not null default public.current_book() check (book in ('live', 'sandbox')),
  -- payments that paid only this bill, voided with it
  payments uuid[] not null default '{}',
  -- every application to or from it, as {from, to, amount}, to put back on restore
  applications jsonb not null default '[]',
  deleted_by uuid default auth.uid() references public.profiles on delete set null,
  deleted_at timestamptz not null default now()
);
alter table public.bill_bin enable row level security;
create policy bill_bin_read on public.bill_bin for select to authenticated
  using (public.is_staff() and book = public.current_book());
revoke all on public.bill_bin from anon;
grant select on public.bill_bin to authenticated;

/** Delete a bill, expense or vendor credit: void it and the payments made only for it, restorable for 30 days. */
create or replace function public.rpc_delete_bill(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transactions; v_apps jsonb; v_pays uuid[]; v_other text;
begin
  select * into t from public.transactions where id = p_id for update;
  if not found then raise exception 'No such bill'; end if;
  perform public._require_book(t.book);
  perform public.require_role('write');
  if t.type not in ('bill', 'expense', 'vendor_credit') then raise exception 'Only bills, expenses and vendor credits are deleted here'; end if;
  if t.voided_at is not null then raise exception 'This is already void or deleted'; end if;

  -- a payment that also paid other bills is not undone here
  select string_agg(distinct coalesce(p.number, 'a payment'), ', ') into v_other
  from public.applications a join public.transactions p on p.id = a.from_transaction_id
  where a.to_transaction_id = p_id and p.voided_at is null and p.type = 'bill_payment'
    and exists (select 1 from public.applications o where o.from_transaction_id = p.id and o.to_transaction_id <> p_id);
  if v_other is not null then
    raise exception 'It was paid together with other bills (%); void that payment first', v_other;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('from', a.from_transaction_id, 'to', a.to_transaction_id, 'amount', a.amount)), '[]') into v_apps
  from public.applications a
  join public.transactions f on f.id = a.from_transaction_id join public.transactions o on o.id = a.to_transaction_id
  where (a.to_transaction_id = p_id or a.from_transaction_id = p_id) and f.voided_at is null and o.voided_at is null;
  select coalesce(array_agg(distinct a.from_transaction_id), '{}') into v_pays
  from public.applications a join public.transactions p on p.id = a.from_transaction_id
  where a.to_transaction_id = p_id and p.voided_at is null and p.type = 'bill_payment';

  -- credits applied to it go back to being available; its own payments are voided with it
  delete from public.applications a using public.transactions f
  where a.to_transaction_id = p_id and f.id = a.from_transaction_id and f.type <> 'bill_payment';
  perform public.void_transaction(x, 'Deleted with ' || coalesce(t.number, 'its bill')) from unnest(v_pays) x;
  perform public.void_transaction(p_id, 'Deleted');
  insert into public.bill_bin (bill_id, book, payments, applications) values (p_id, t.book, v_pays, v_apps);
end $$;

/** Put back a deleted bill within 30 days, with its payments, as it was. */
create or replace function public.rpc_restore_bill(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bill_bin; app jsonb; x uuid;
begin
  select * into b from public.bill_bin where bill_id = p_id for update;
  if not found then raise exception 'That bill is not in deleted bills'; end if;
  perform public._require_book(b.book);
  perform public.require_role('write');
  if b.deleted_at < now() - interval '30 days' then raise exception 'It was deleted over 30 days ago, so it can no longer be restored'; end if;

  update public.transactions set voided_at = null, void_reason = null, updated_at = now() where id = p_id or id = any (b.payments);
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

revoke execute on function public.rpc_delete_bill(uuid) from public, anon;
revoke execute on function public.rpc_restore_bill(uuid) from public, anon;
grant execute on function public.rpc_delete_bill(uuid) to authenticated;
grant execute on function public.rpc_restore_bill(uuid) to authenticated;
