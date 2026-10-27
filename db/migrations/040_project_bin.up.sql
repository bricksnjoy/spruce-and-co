-- 040 · Deleting a project with all its information, restorable for 30 days.
-- Deleting voids every document of the project (its invoices, bills, expenses,
-- payments, credits, financing and payouts), reverses its profit split, and hides
-- the project and its documents everywhere: the read policies leave out a
-- deleted project, the documents it took with it, and its tasks, phases and
-- milestones, so no list, report or picker shows them. What is needed to put it
-- all back is kept in project_bin; restoring within 30 days un-voids and posts
-- the documents again, re-applies the payments, and completes the project again
-- if it was completed. After 30 days it can no longer be restored and stays
-- hidden, its void documents kept in the database for the audit trail.
--
-- A project is refused while a document of it also belongs to another project,
-- a payment of it also pays another project's documents, a payroll run charged
-- labour to it, one of its documents is in a filed GST return, or a director's
-- account has already used money from it.

alter table public.projects add column if not exists deleted_at timestamptz;
alter table public.projects add column if not exists deleted_by uuid references public.profiles on delete set null;
alter table public.transactions add column if not exists deleted_with uuid references public.projects on delete set null;

/** Whether a project is deleted, seen past the read policies (which hide it). */
create or replace function public.project_deleted(p_project uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select deleted_at is not null from public.projects where id = p_project), false)
$$;

drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select
  using (public.is_staff() and book = public.current_book() and deleted_at is null);
drop policy if exists projects_upd on public.projects;
create policy projects_upd on public.projects for update
  using (public.can_write() and book = public.current_book() and deleted_at is null) with check (book = public.current_book());
drop policy if exists transactions_read on public.transactions;
create policy transactions_read on public.transactions for select to authenticated
  using (public.is_staff() and book = public.current_book() and (not public._payroll_type(type) or public.has_payroll()) and deleted_with is null);
-- the older project tables (in Live, not in every copy of the database)
do $$
declare t text;
begin
  foreach t in array array['project_tasks', 'project_phases', 'milestones'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_read', t);
      execute format('create policy %I on public.%I for select to authenticated using (public.is_staff() and not public.project_deleted(project_id))', t || '_read', t);
    end if;
  end loop;
end $$;

create table public.project_bin (
  project_id uuid primary key references public.projects on delete cascade,
  book text not null check (book in ('live', 'sandbox')),
  -- documents the deletion voided, put back on restore; and those already void, only unhidden
  documents uuid[] not null default '{}',
  already_void uuid[] not null default '{}',
  -- every application between them, billing stages' invoices, standing labour allocations and bank rules pointing at it
  applications jsonb not null default '[]',
  stage_invoices jsonb not null default '[]',
  employee_allocations jsonb not null default '[]',
  bank_rules uuid[] not null default '{}',
  completed_at timestamptz,
  deleted_by uuid default auth.uid() references public.profiles on delete set null,
  deleted_at timestamptz not null default now()
);
alter table public.project_bin enable row level security;
create policy project_bin_read on public.project_bin for select to authenticated using (public.is_admin() and book = public.current_book());
revoke all on public.project_bin from anon;
grant select on public.project_bin to authenticated;

/** No director's account may go below nothing. */
create or replace function public._check_director_accounts(p_book text, p_what text) returns void language plpgsql set search_path = public, pg_temp as $$
declare v text;
begin
  select string_agg(c.name, ', ') into v from public.director_accounts_v d join public.contacts c on c.id = d.contact_id
  where d.book = p_book and d.balance < -0.005;
  if v is not null then
    raise exception '%: % would be left with less than nothing in their director''s account', p_what, v;
  end if;
end $$;

/**
 * Delete a project with all its information (admin only, after typing its code):
 * its documents are voided and hidden with it, and its profit split is reversed.
 * Restorable for 30 days with rpc_restore_project.
 */
create or replace function public.rpc_delete_project(p_project uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.projects; v_docs uuid[]; v_void uuid[]; v_bad text; x uuid; v_reason text;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'No such project'; end if;
  perform public._require_book(p.book);
  perform public.require_role('admin');
  if p.deleted_at is not null then raise exception 'This project is already deleted'; end if;
  if trim(coalesce(p_confirm, '')) <> p.code then raise exception 'Type the project code % to delete it', p.code; end if;

  -- its documents, headed to it or with a line on it (the profit split is undone on its own)
  select coalesce(array_agg(t.id), '{}') into v_docs from public.transactions t
  where t.voided_at is null and t.type <> 'distribution'
    and (t.project_id = p_project or exists (select 1 from public.transaction_lines l where l.transaction_id = t.id and l.project_id = p_project));
  -- and the payments and credits applied to them
  select v_docs || coalesce(array_agg(distinct a.from_transaction_id), '{}') into v_docs
  from public.applications a join public.transactions f on f.id = a.from_transaction_id
  where a.to_transaction_id = any (v_docs) and f.voided_at is null and not (a.from_transaction_id = any (v_docs));
  select coalesce(array_agg(t.id), '{}') into v_void from public.transactions t
  where t.voided_at is not null and t.deleted_with is null
    and (t.project_id = p_project or exists (select 1 from public.transaction_lines l where l.transaction_id = t.id and l.project_id = p_project));

  select string_agg(distinct coalesce(t.number, 'a payroll run'), ', ') into v_bad from public.journal_lines j join public.transactions t on t.id = j.transaction_id
  where j.project_id = p_project and t.type = 'payroll_run' and t.voided_at is null;
  if v_bad is not null then raise exception 'Payroll % charged labour to this project; a payroll run cannot be deleted with it', v_bad; end if;
  select string_agg(distinct coalesce(t.number, t.type::text), ', ') into v_bad from public.transactions t
  where t.id = any (v_docs) and ((t.project_id is not null and t.project_id <> p_project)
    or exists (select 1 from public.transaction_lines l where l.transaction_id = t.id and l.project_id is not null and l.project_id <> p_project));
  if v_bad is not null then raise exception 'These also belong to another project: %. Move or void them first', v_bad; end if;
  select string_agg(distinct coalesce(f.number, f.type::text), ', ') into v_bad from public.applications a
  join public.transactions f on f.id = a.from_transaction_id join public.transactions o on o.id = a.to_transaction_id
  where a.from_transaction_id = any (v_docs) and not (a.to_transaction_id = any (v_docs)) and o.voided_at is null;
  if v_bad is not null then raise exception 'These also pay documents of another project: %. Void them first', v_bad; end if;
  if exists (select 1 from public.journal_lines j where j.transaction_id = any (v_docs) and public._line_frozen(j.tax_period_id)) then
    raise exception 'Some of its documents are in a filed GST return, so they cannot be deleted';
  end if;

  insert into public.project_bin (project_id, book, documents, already_void, applications, stage_invoices, employee_allocations, bank_rules, completed_at)
  values (p_project, p.book, v_docs, v_void,
    (select coalesce(jsonb_agg(jsonb_build_object('from', a.from_transaction_id, 'to', a.to_transaction_id, 'amount', a.amount)), '[]')
       from public.applications a where a.from_transaction_id = any (v_docs) or a.to_transaction_id = any (v_docs)),
    (select coalesce(jsonb_agg(jsonb_build_object('stage', s.id, 'invoice', s.invoice_id)), '[]')
       from public.billing_stages s where s.project_id = p_project and s.invoice_id is not null),
    (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.employee_allocations e where e.project_id = p_project),
    (select coalesce(array_agg(r.id), '{}') from public.bank_rules r where r.project_id = p_project),
    p.completed_at);

  update public.projects set deleted_at = now(), deleted_by = auth.uid() where id = p_project;
  update public.transactions set deleted_with = p_project where id = any (v_docs) or id = any (v_void);
  v_reason := 'Deleted with project ' || p.code;
  -- payouts first, then the profit split, then payments and credits before what they pay
  for x in select id from public.transactions where id = any (v_docs) and type = 'payout' loop
    perform public.void_transaction(x, v_reason);
  end loop;
  if p.completed_at is not null then
    update public.projects set completed_at = null, status = 'in_progress' where id = p_project;
    -- the split entries are voided and stay hidden; a restore completes the project again with new ones
    for x in select journal_transaction_id from public.distributions where project_id = p_project and journal_transaction_id is not null order by created_at desc loop
      perform public.void_transaction(x, v_reason);
      update public.transactions set deleted_with = p_project where id = x;
    end loop;
    delete from public.distributions where project_id = p_project;
  end if;
  for x in select id from public.transactions where id = any (v_docs) and voided_at is null
           order by case when type in ('customer_payment', 'bill_payment', 'advance_application') then 0
                         when type in ('credit_note', 'vendor_credit') then 1
                         when type in ('capital_contribution', 'loan_receipt') then 3 else 2 end, date loop
    perform public.void_transaction(x, v_reason);
  end loop;
  delete from public.employee_allocations where project_id = p_project;
  update public.bank_rules set project_id = null where project_id = p_project;
  perform public._check_director_accounts(p.book, 'Money from this project has already been used');
end $$;

/** Put a deleted project back as it was, within 30 days of deleting it (admin only). */
create or replace function public.rpc_restore_project(p_project uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.project_bin; x uuid; app jsonb;
begin
  select * into b from public.project_bin where project_id = p_project for update;
  if not found then raise exception 'That project is not in deleted projects'; end if;
  perform public._require_book(b.book);
  perform public.require_role('admin');
  if b.deleted_at < now() - interval '30 days' then raise exception 'It was deleted over 30 days ago, so it can no longer be restored'; end if;

  update public.projects set deleted_at = null, deleted_by = null where id = p_project;
  update public.transactions set deleted_with = null where id = any (b.documents) or id = any (b.already_void);
  update public.transactions set voided_at = null, void_reason = null, updated_at = now() where id = any (b.documents);
  -- what is paid before what pays it; payouts once the split is back
  for x in select id from public.transactions where id = any (b.documents) and type <> 'payout'
           order by case when type in ('capital_contribution', 'loan_receipt') then 0 when type in ('credit_note', 'vendor_credit') then 2
                         when type in ('customer_payment', 'bill_payment', 'advance_application') then 3 else 1 end, date loop
    perform public.post_transaction(x);
  end loop;
  for app in select * from jsonb_array_elements(b.applications) loop
    insert into public.applications (from_transaction_id, to_transaction_id, amount)
    values ((app ->> 'from')::uuid, (app ->> 'to')::uuid, (app ->> 'amount')::numeric);
  end loop;
  for x in select id from public.transactions where id = any (b.documents) and type <> 'payout'
           and id in (select (a ->> 'from')::uuid from jsonb_array_elements(b.applications) a) loop
    perform public.post_transaction(x);
  end loop;
  update public.billing_stages s set invoice_id = (st ->> 'invoice')::uuid
  from jsonb_array_elements(b.stage_invoices) st where s.id = (st ->> 'stage')::uuid;
  if b.completed_at is not null then perform public.complete_project(p_project, b.completed_at::date); end if;
  for x in select id from public.transactions where id = any (b.documents) and type = 'payout' order by date loop
    perform public.post_transaction(x);
  end loop;
  insert into public.employee_allocations select * from jsonb_populate_recordset(null::public.employee_allocations, b.employee_allocations);
  update public.bank_rules set project_id = p_project where id = any (b.bank_rules);
  delete from public.project_bin where project_id = p_project;
  perform public._check_director_accounts(b.book, 'Money this project took from directors'' accounts has since been used');
end $$;

/** Deleted projects that can still be restored, in the current book (admin only). */
create or replace function public.deleted_projects()
returns table (id uuid, code text, name text, customer_name text, deleted_at timestamptz, deleted_by text, documents int)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.code, p.name, c.name, b.deleted_at, pr.full_name, cardinality(b.documents)
  from public.project_bin b join public.projects p on p.id = b.project_id
  left join public.contacts c on c.id = p.customer_id left join public.profiles pr on pr.id = b.deleted_by
  where public.is_admin() and b.book = public.current_book() and b.deleted_at >= now() - interval '30 days'
  order by b.deleted_at desc
$$;

revoke execute on function public.project_deleted(uuid) from public, anon;
revoke execute on function public._check_director_accounts(text, text) from public, anon, authenticated;
revoke execute on function public.rpc_delete_project(uuid, text) from public, anon;
revoke execute on function public.rpc_restore_project(uuid) from public, anon;
revoke execute on function public.deleted_projects() from public, anon;
grant execute on function public.project_deleted(uuid) to authenticated;
grant execute on function public.rpc_delete_project(uuid, text) to authenticated;
grant execute on function public.rpc_restore_project(uuid) to authenticated;
grant execute on function public.deleted_projects() to authenticated;
