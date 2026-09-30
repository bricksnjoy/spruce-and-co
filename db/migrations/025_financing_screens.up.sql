-- 025 · Financing and profit-share screens (§5, §6, feature: approval workflows).
-- • A payout posts only once an admin (the MD) has approved it, and only for
--   exactly the lines approved: who, which project, which component, how much.
--   A payout an admin records is approved as it is saved.
-- • Profit-share schemes are versioned from the Settings screen. A new version
--   applies to every project that starts on or after its date and has not been
--   split yet (P6: the scheme in force when the project starts).

alter table public.transactions add column if not exists approved_snapshot jsonb;

/** A payout's lines in a fixed order, to compare what was approved with what is posted. */
create or replace function public._payout_lines(p_id uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_array(coalesce(l.contact_id, t.contact_id), coalesce(l.project_id, t.project_id), l.component, round(l.amount, 2))
    order by coalesce(l.project_id, t.project_id), l.component, coalesce(l.contact_id, t.contact_id), l.amount), '[]')
  from public.transactions t join public.transaction_lines l on l.transaction_id = t.id where t.id = p_id
$$;

create or replace function public.check_payout_approval() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare t public.transactions;
begin
  if public._purging() then return null; end if;
  select * into t from public.transactions where id = new.id;
  if not found or t.type <> 'payout' or t.is_draft or t.voided_at is not null then return null; end if;
  if t.approval_status <> 'approved' or t.approved_snapshot is distinct from public._payout_lines(t.id) then
    raise exception 'A payout needs an admin''s approval before it is paid' using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger transactions_payout_approval after insert or update on public.transactions
  deferrable initially deferred for each row execute function public.check_payout_approval();

/** Approve a payout as it stands and pay it (the gate in _payout_gate still applies). */
create or replace function public._approve_payout(p_id uuid) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update public.transactions set approval_status = 'approved', approved_by = auth.uid(), approved_at = now(),
    approved_snapshot = public._payout_lines(p_id), approved_total = total_amount, is_draft = false, updated_at = now()
  where id = p_id;
  perform public.post_transaction(p_id);
end $$;

/**
 * Save a payout: one person, one bank account, one line per project and
 * component. Saved as a draft awaiting approval, or approved and paid at once
 * when an admin saves it. Only a new or draft payout can be saved here.
 */
create or replace function public.rpc_save_payout(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; t public.transactions; v_total numeric;
begin
  perform public.require_role('write');
  if v_id is not null then
    select * into t from public.transactions where id = v_id;
    perform public._require_book(t.book);
    if t.type <> 'payout' or not t.is_draft or t.voided_at is not null then raise exception 'Only a payout awaiting approval can be changed'; end if;
  end if;
  if nullif(p ->> 'contact_id', '') is null then raise exception 'Choose who is paid'; end if;
  if nullif(p ->> 'bank_account_id', '') is null then raise exception 'Choose the account it is paid from'; end if;
  select coalesce(sum((l ->> 'amount')::numeric), 0) into v_total from jsonb_array_elements(coalesce(p -> 'lines', '[]')) l;
  if v_total <= 0 then raise exception 'A payout needs at least one amount'; end if;
  if exists (select 1 from jsonb_array_elements(p -> 'lines') l where (l ->> 'amount')::numeric <= 0) then
    raise exception 'Each amount paid must be more than 0';
  end if;
  v_id := public.rpc_save_transaction(p || jsonb_build_object('type', 'payout', 'is_draft', true, 'total_amount', v_total,
    'lines', (select jsonb_agg(l || jsonb_build_object('contact_id', p ->> 'contact_id')) from jsonb_array_elements(p -> 'lines') l)));
  if public.is_admin() then
    perform public._approve_payout(v_id);
  else
    update public.transactions set approval_status = 'pending', approved_snapshot = null, updated_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

/** An admin approves a payout awaiting approval, and it is paid. */
create or replace function public.rpc_approve_payout(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transactions;
begin
  perform public.require_role('admin');
  select * into t from public.transactions where id = p_id for update;
  perform public._require_book(t.book);
  if t.type <> 'payout' or not t.is_draft or t.voided_at is not null then raise exception 'Only a payout awaiting approval can be approved'; end if;
  perform public._approve_payout(p_id);
end $$;

-- ── profit-share schemes ─────────────────────────────────────────────────

/** Point every project not yet split at the scheme in force when it started. */
create or replace function public._reassign_schemes() returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update public.projects p set scheme_id = public.scheme_on(coalesce(p.start_date, p.created_at::date))
  where not exists (select 1 from public.distributions d where d.project_id = p.id)
    and public.scheme_on(coalesce(p.start_date, p.created_at::date)) is not null
    and p.scheme_id is distinct from public.scheme_on(coalesce(p.start_date, p.created_at::date));
end $$;

/**
 * Add a scheme version: {name, effective_from, allocations: [{party_type,
 * contact_id, percent}]}. It must total 100% (checked when the transaction ends).
 */
create or replace function public.rpc_save_scheme(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; a jsonb; i int := 0;
begin
  perform public.require_role('admin');
  if nullif(trim(p ->> 'name'), '') is null then raise exception 'Name the scheme'; end if;
  if nullif(p ->> 'effective_from', '') is null then raise exception 'Enter the date the scheme starts'; end if;
  if exists (select 1 from public.profit_schemes where effective_from = (p ->> 'effective_from')::date) then
    raise exception 'A scheme already starts on that date';
  end if;
  if exists (select 1 from public.distributions d join public.projects pr on pr.id = d.project_id
             where coalesce(pr.start_date, pr.created_at::date) >= (p ->> 'effective_from')::date) then
    raise exception 'A project that started on or after that date has already been split; choose a later date';
  end if;
  insert into public.profit_schemes (name, effective_from) values (trim(p ->> 'name'), (p ->> 'effective_from')::date) returning id into v_id;
  for a in select * from jsonb_array_elements(coalesce(p -> 'allocations', '[]')) loop
    i := i + 1;
    if coalesce((a ->> 'percent')::numeric, 0) = 0 then continue; end if;
    insert into public.scheme_allocations (scheme_id, party_type, contact_id, percent, sort_order)
    values (v_id, a ->> 'party_type', nullif(a ->> 'contact_id', '')::uuid, (a ->> 'percent')::numeric, i);
  end loop;
  if (select coalesce(sum(percent), 0) from public.scheme_allocations where scheme_id = v_id) <> 100 then
    raise exception 'A profit-share scheme must total 100%% (this one totals %)',
      (select coalesce(sum(percent), 0) from public.scheme_allocations where scheme_id = v_id) using errcode = 'P0001';
  end if;
  perform public._reassign_schemes();
  return v_id;
end $$;

/** Remove a scheme version that no project has been split under; its projects go back to the version before. */
create or replace function public.rpc_delete_scheme(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('admin');
  if exists (select 1 from public.distributions where scheme_id = p_id) then
    raise exception 'Projects have been split under this scheme, so it is kept';
  end if;
  if (select count(*) from public.profit_schemes) <= 1 then raise exception 'There must always be one scheme'; end if;
  if exists (select 1 from public.projects p where p.scheme_id = p_id
             and public.scheme_on(coalesce(p.start_date, p.created_at::date)) = p_id
             and not exists (select 1 from public.profit_schemes s where s.id <> p_id and s.effective_from <= coalesce(p.start_date, p.created_at::date))) then
    raise exception 'A project started before any other scheme, so this one is kept';
  end if;
  update public.projects p set scheme_id = (select s.id from public.profit_schemes s where s.id <> p_id
      and s.effective_from <= coalesce(p.start_date, p.created_at::date) order by s.effective_from desc limit 1)
  where p.scheme_id = p_id;
  delete from public.profit_schemes where id = p_id;
  perform public._reassign_schemes();
end $$;

/** Every project's split and payout state, for the financing screens. */
create or replace view public.project_payouts_v with (security_invoker = on) as
select p.id, p.book, p.code, p.name, p.completed_at, public.project_stage(p.id) as stage, s.name as scheme_name,
  (select coalesce(sum(f.received), 0) from public.project_financing_v f where f.project_id = p.id) as financed,
  (select coalesce(sum(f.outstanding), 0) from public.project_financing_v f where f.project_id = p.id) as principal_outstanding,
  (select coalesce(sum(st.outstanding), 0) from public.partner_statement_v st where st.project_id = p.id and st.component <> 'principal') as returns_outstanding,
  (select d.profit_amount from public.distributions d where d.project_id = p.id order by d.created_at desc limit 1) as split_profit,
  ps.blocked, ps.reason as blocked_reason, ps.client_owes
from public.projects p
left join public.profit_schemes s on s.id = p.scheme_id
cross join lateral public.payout_status(p.id) ps;

revoke execute on function public._payout_lines(uuid) from public, anon;
grant execute on function public._payout_lines(uuid) to authenticated;
revoke execute on function public.check_payout_approval() from public, anon, authenticated;
revoke execute on function public._approve_payout(uuid) from public, anon, authenticated;
revoke execute on function public._reassign_schemes() from public, anon, authenticated;
revoke execute on function public.rpc_save_payout(jsonb) from public, anon;
revoke execute on function public.rpc_approve_payout(uuid) from public, anon;
revoke execute on function public.rpc_save_scheme(jsonb) from public, anon;
revoke execute on function public.rpc_delete_scheme(uuid) from public, anon;
grant execute on function public.rpc_save_payout(jsonb) to authenticated;
grant execute on function public.rpc_approve_payout(uuid) to authenticated;
grant execute on function public.rpc_save_scheme(jsonb) to authenticated;
grant execute on function public.rpc_delete_scheme(uuid) to authenticated;
