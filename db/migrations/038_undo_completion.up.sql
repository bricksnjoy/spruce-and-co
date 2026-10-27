-- 038 · Undo a project's completion (admin only): the project goes back to active
-- and its profit split is reversed. Each split entry (the one posted on completion
-- and any later adjustment) is voided, so the books keep it as a void entry, and
-- the split worked out from it is cleared, so later costs no longer adjust a split
-- and the project can be completed again. Refused while any profit share or
-- financing return from the project has been paid out or awaits approval: that
-- payout must be voided first.
create or replace function public.rpc_undo_completion(p_project uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.projects; v_paid text; v_txn uuid;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'No such project'; end if;
  perform public._require_book(p.book);
  perform public.require_role('admin');
  if p.completed_at is null then raise exception 'This project is not completed'; end if;

  select string_agg(distinct coalesce(t.number, 'a payout'), ', ') into v_paid
  from public.transaction_lines l join public.transactions t on t.id = l.transaction_id
  where t.type = 'payout' and t.voided_at is null and l.project_id = p_project and l.component in ('profit_share', 'financing_return');
  if v_paid is not null then
    raise exception 'Profit from this project has been paid out (%); void those payouts first', v_paid;
  end if;

  update public.projects set completed_at = null, status = 'in_progress' where id = p_project;
  for v_txn in select journal_transaction_id from public.distributions
               where project_id = p_project and journal_transaction_id is not null order by created_at desc loop
    perform public.void_transaction(v_txn, 'Completion undone');
  end loop;
  delete from public.distributions where project_id = p_project;
end $$;

revoke execute on function public.rpc_undo_completion(uuid) from public, anon;
grant execute on function public.rpc_undo_completion(uuid) to authenticated;
