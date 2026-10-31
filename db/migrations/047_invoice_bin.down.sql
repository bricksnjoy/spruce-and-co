drop function if exists public.rpc_delete_sales_doc(uuid, boolean);

-- rpc_restore_bill as 037 made it
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

alter table public.bill_bin drop column if exists stage_id;
