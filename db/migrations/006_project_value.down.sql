drop trigger if exists budget_lines_audit on public.budget_lines;
drop function if exists public.run_wip(date);
drop function if exists public.project_stage(uuid);
drop view if exists public.project_value_v;
drop function if exists public.project_figures(uuid, date);
drop type if exists public.project_figures_t;
drop function if exists public.project_profit(uuid, date);
drop function if exists public.client_balance(uuid, date);
drop table if exists public.billing_stages;
alter table public.budget_lines drop column if exists forecast_to_complete, drop column if exists revised_amount, drop column if exists budget_category;
drop trigger if exists variations_number on public.variations;
drop function if exists public.number_variation();
drop index if exists public.variations_number;
alter table public.variations drop column if exists amount, drop column if exists number;
alter table public.projects drop column if exists review_flag, drop column if exists recognition_method,
  drop column if exists scheme_id, drop column if exists customer_id;
