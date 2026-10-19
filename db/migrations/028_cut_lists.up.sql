-- The board cut planner's list, kept for each person so it is there on every
-- device they sign in on. Not part of the books: no book column, so the same
-- list shows in the Live and Test books, and nothing here touches the ledger.
create table public.cut_lists (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 262144),
  updated_at timestamptz not null default now()
);
alter table public.cut_lists enable row level security;
-- each person sees and saves only their own list
create policy cut_lists_own on public.cut_lists for all to authenticated
  using (user_id = auth.uid() and public.is_staff())
  with check (user_id = auth.uid() and public.is_staff());
revoke all on public.cut_lists from anon;
grant select, insert, update on public.cut_lists to authenticated;

-- Save a list unless another device saved one since this device last loaded it
-- (p_base is the time of the copy it started from). On a clash nothing is
-- written and the other device's list comes back, for the person to choose.
create or replace function public.rpc_save_cut_list(p_data jsonb, p_base timestamptz) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare cur public.cut_lists; v_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  select * into cur from public.cut_lists where user_id = auth.uid() for update;
  if found and p_base is distinct from cur.updated_at then
    return jsonb_build_object('conflict', true, 'data', cur.data, 'updated_at', cur.updated_at);
  end if;
  insert into public.cut_lists (user_id, data, updated_at) values (auth.uid(), p_data, v_at)
  on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at;
  return jsonb_build_object('updated_at', v_at);
end $$;
revoke all on function public.rpc_save_cut_list(jsonb, timestamptz) from anon, public;
grant execute on function public.rpc_save_cut_list(jsonb, timestamptz) to authenticated;
