-- 017 · Clients and customers are one list (decision, 30 Sep 2026).
-- Customers (contacts) are the list people use. The old `clients` table stays
-- only because older screens (quotations, invoices, the cabinet estimator)
-- still point at it: every Live customer has a mirrored client row, kept in
-- step here. A project's customer and its old client field always agree.
-- Nothing is deleted. The Test book has no mirror: the old tables are Live only.

create or replace function public._mirroring() returns boolean language sql stable as $$
  select coalesce(current_setting('app.mirroring', true), '') = 'on'
$$;

/** A Live customer's details, written to its mirrored client row (created the first time). */
create or replace function public.mirror_contact_to_client() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cid uuid := nullif(new.legacy ->> 'client_id', '')::uuid;
begin
  if public._mirroring() or new.book <> 'live' or not ('customer' = any (new.kinds)) then return new; end if;
  perform set_config('app.mirroring', 'on', true);
  if cid is not null and exists (select 1 from public.clients where id = cid) then
    update public.clients set name = new.name, contact_name = new.contact_person, email = new.email, phone = new.phone,
      address = new.address, tax_number = new.tin, notes = new.notes, is_active = new.active, updated_at = now()
    where id = cid;
  else
    insert into public.clients (name, type, contact_name, email, phone, address, tax_number, notes, is_active, created_by)
    values (new.name, 'company', new.contact_person, new.email, new.phone, new.address, new.tin, new.notes, new.active, auth.uid())
    returning id into cid;
    new.legacy := coalesce(new.legacy, '{}'::jsonb) || jsonb_build_object('client_id', cid);
  end if;
  perform set_config('app.mirroring', 'off', true);
  return new;
end $$;
create trigger contacts_mirror_client before insert or update on public.contacts
  for each row execute function public.mirror_contact_to_client();

/** A client added or changed by an older screen shows up as a Live customer. */
create or replace function public.mirror_client_to_contact() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public._mirroring() then return new; end if;
  perform set_config('app.mirroring', 'on', true);
  update public.contacts set name = new.name, contact_person = new.contact_name, email = new.email, phone = new.phone,
    address = new.address, tin = new.tax_number, notes = new.notes, active = new.is_active, updated_at = now()
  where legacy ->> 'client_id' = new.id::text and book = 'live';
  if not found then
    insert into public.contacts (kinds, name, contact_person, email, phone, address, tin, notes, active, book, legacy)
    values (array['customer'], new.name, new.contact_name, new.email, new.phone, new.address, new.tax_number, new.notes,
      new.is_active, 'live', jsonb_build_object('client_id', new.id));
  end if;
  perform set_config('app.mirroring', 'off', true);
  return new;
end $$;
create trigger clients_mirror_contact after insert or update on public.clients
  for each row execute function public.mirror_client_to_contact();

/** A project's customer and old client field always point at the same party. */
create or replace function public.sync_project_customer() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contact public.contacts;
begin
  if new.customer_id is not null and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) then
    select * into v_contact from public.contacts where id = new.customer_id;
    if not ('customer' = any (v_contact.kinds)) then raise exception '% is not a customer', v_contact.name; end if;
    new.client_id := case when new.book = 'live' then nullif(v_contact.legacy ->> 'client_id', '')::uuid end;
  elsif new.customer_id is null and tg_op = 'UPDATE' and old.customer_id is not null and new.client_id is not distinct from old.client_id then
    new.client_id := null;   -- the customer was cleared
  elsif new.client_id is distinct from (case when tg_op = 'UPDATE' then old.client_id end) then
    -- an older screen set the client: find (or mirror) its customer
    if new.client_id is null then
      new.customer_id := null;
    else
      select id into new.customer_id from public.contacts where legacy ->> 'client_id' = new.client_id::text and book = 'live' limit 1;
    end if;
  end if;
  return new;
end $$;
create trigger projects_customer before insert or update of customer_id, client_id on public.projects
  for each row execute function public.sync_project_customer();

-- bring what exists into line: every Live customer mirrored, every project's two fields agreeing
update public.contacts set updated_at = updated_at where book = 'live' and 'customer' = any (kinds);
update public.projects p set customer_id = c.id
  from public.contacts c where c.legacy ->> 'client_id' = p.client_id::text and c.book = 'live' and p.customer_id is distinct from c.id;

revoke execute on function public.mirror_contact_to_client() from public, anon, authenticated;
revoke execute on function public.mirror_client_to_contact() from public, anon, authenticated;
revoke execute on function public.sync_project_customer() from public, anon, authenticated;
