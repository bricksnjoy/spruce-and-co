-- Users for the browser tests, one per role (throwaway local database only).
-- Password for all: e2e-Passw0rd!
do $$
declare u record;
begin
  for u in select * from (values
    ('00000000-0000-0000-0000-0000000000a1'::uuid, 'admin@e2e.test', 'Ella Admin', 'admin'),
    ('00000000-0000-0000-0000-0000000000b2'::uuid, 'manager@e2e.test', 'Mo Manager', 'manager'),
    ('00000000-0000-0000-0000-0000000000c3'::uuid, 'viewer@e2e.test', 'Vi Viewer', 'viewer')) x(id, email, name, role)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('e2e-Passw0rd!', extensions.gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now())
    on conflict do nothing;
    insert into public.profiles (id, full_name, email, role)
    values (u.id, u.name, u.email, u.role::public.user_role)
    on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  end loop;
end $$;

insert into public.company (id, legal_name, trade_name, tin, gst_registered)
values (true, 'Spruce & Co Pvt Ltd (E2E)', 'Spruce & Co', '1000999GST501', true)
on conflict (id) do update set gst_registered = true;
update public.settings set gst_registered = true;
insert into public.rates (kind, code, brackets, effective_from)
select 'wht', 'default', '[{"from": 0, "to": null, "rate": 0}]', '2020-01-01'
where not exists (select 1 from public.rates where kind = 'wht');
