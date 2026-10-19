-- the mirrored rows stay (nothing is deleted); only the keeping-in-step stops
drop trigger if exists projects_customer on public.projects;
drop trigger if exists clients_mirror_contact on public.clients;
drop trigger if exists contacts_mirror_client on public.contacts;
drop function if exists public.sync_project_customer();
drop function if exists public.mirror_client_to_contact();
drop function if exists public.mirror_contact_to_client();
drop function if exists public._mirroring();
