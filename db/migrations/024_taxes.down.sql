drop trigger if exists settings_gst_due_day on public.settings;
drop function if exists public.sync_gst_due_dates();
drop trigger if exists tax_periods_snapshot on public.tax_periods;
drop function if exists public.snapshot_gst_schedule();
drop function if exists public.gst_supplies(date, date);
drop function if exists public.gst_schedule(uuid);
drop function if exists public._gst_schedule_now(uuid);
alter table public.tax_periods drop column if exists schedule;
