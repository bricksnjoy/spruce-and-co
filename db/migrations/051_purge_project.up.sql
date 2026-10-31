-- 051 · Deleting a project for good from deleted projects.
-- It leaves the bin, so it can no longer be restored and no longer shows in
-- Projects → Deleted. The project stays hidden, and its void documents stay in
-- the database for the audit trail, as after the 30 days.

/** Delete a deleted project for good: it can no longer be restored (admin only). */
create or replace function public.rpc_purge_project(p_project uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.project_bin;
begin
  select * into b from public.project_bin where project_id = p_project for update;
  if not found then raise exception 'That project is not in deleted projects'; end if;
  perform public._require_book(b.book);
  perform public.require_role('admin');
  delete from public.project_bin where project_id = p_project;
end $$;

revoke execute on function public.rpc_purge_project(uuid) from public, anon;
grant execute on function public.rpc_purge_project(uuid) to authenticated;
