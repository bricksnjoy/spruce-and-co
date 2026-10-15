-- Removes the saved cut lists (the planner falls back to keeping its list in the browser).
drop function if exists public.rpc_save_cut_list(jsonb, timestamptz);
drop table if exists public.cut_lists;
