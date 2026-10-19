-- 024 · Taxes screens (§8). What a GST return is made of, document by document,
-- and the value of supplies by tax code for the return form. Open returns'
-- due dates follow the due-day setting when it changes.

/** What a return's schedules showed on the day it was filed. */
alter table public.tax_periods add column schedule jsonb;

/**
 * Each document in a return, output or input side, worked out from the lines.
 * `late` = dated before the period (it landed here because its own quarter was
 * filed); `correction` = the document was already in an earlier return and
 * only the difference is here, so there is no taxable value to show.
 */
create or replace function public._gst_schedule_now(p_period uuid)
returns table (side text, transaction_id uuid, date date, type text, number text, contact_name text, tin text,
  tax_invoice_no text, tax_invoice_date date, customs_ref text, taxable numeric, gst numeric, late boolean, correction boolean)
language sql stable set search_path = public, pg_temp as $$
  with p as (select * from public.tax_periods where id = p_period),
  g as (
    select case when a.subtype = 'gst_output' then 'output' else 'input' end side, a.subtype, j.transaction_id,
      sum(case when a.subtype = 'gst_output' then j.home_credit - j.home_debit else j.home_debit - j.home_credit end) gst
    from public.journal_lines j
    join public.accounts a on a.id = j.account_id
    join public.transactions t on t.id = j.transaction_id
    where j.tax_period_id = p_period and a.subtype in ('gst_output', 'gst_input') and t.type not in ('gst_settlement', 'gst_payment')
    group by 1, 2, 3
  ),
  x as (
    select g.*, exists (select 1 from public.journal_lines j2 join public.accounts a2 on a2.id = j2.account_id
      join public.tax_periods p2 on p2.id = j2.tax_period_id
      where j2.transaction_id = g.transaction_id and a2.subtype = g.subtype and p2.start_date < (select start_date from p)) corr
    from g where g.gst <> 0
  )
  select x.side, t.id, t.date, t.type::text, t.number, c.name, coalesce(t.supplier_tin, c.tin), t.tax_invoice_no, t.tax_invoice_date, t.customs_ref,
    case when x.corr then null else sign(x.gst) * abs((select coalesce(round(sum(l.amount * t.fx_rate), 2), 0) from public.transaction_lines l
      where l.transaction_id = t.id and l.tax_amount <> 0 and (x.side = 'output' or l.gst_claimable))) end,
    x.gst, t.date < p.start_date, x.corr
  from x join public.transactions t on t.id = x.transaction_id cross join p
  left join public.contacts c on c.id = t.contact_id
  order by x.side desc, t.date, t.number
$$;

/** A filed return's schedule as filed; an open one's as it stands. */
create or replace function public.gst_schedule(p_period uuid)
returns table (side text, transaction_id uuid, date date, type text, number text, contact_name text, tin text,
  tax_invoice_no text, tax_invoice_date date, customs_ref text, taxable numeric, gst numeric, late boolean, correction boolean)
language plpgsql stable set search_path = public, pg_temp as $$
declare snap jsonb := (select schedule from public.tax_periods where id = p_period and status <> 'open');
begin
  if snap is null then return query select * from public._gst_schedule_now(p_period); return; end if;
  return query select * from jsonb_to_recordset(snap) as r(side text, transaction_id uuid, date date, type text, number text,
    contact_name text, tin text, tax_invoice_no text, tax_invoice_date date, customs_ref text, taxable numeric, gst numeric, late boolean, correction boolean);
end $$;

/** Filing keeps the schedule as it was, so later edits to a document never change what was filed. */
create or replace function public.snapshot_gst_schedule() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'open' and new.status <> 'open' then
    new.schedule := coalesce((select jsonb_agg(to_jsonb(s)) from public._gst_schedule_now(new.id) s), '[]'::jsonb);
  end if;
  return new;
end $$;
create trigger tax_periods_snapshot before update of status on public.tax_periods
  for each row execute function public.snapshot_gst_schedule();

/** Value of sales and purchases by tax code kind, by document date (posted, not voided); credits count negative. */
create or replace function public.gst_supplies(p_from date, p_to date)
returns table (side text, kind text, net numeric, gst numeric)
language sql stable set search_path = public, pg_temp as $$
  select case when t.type in ('invoice', 'sales_receipt', 'credit_note') then 'sales' else 'purchases' end,
    coalesce(tc.kind, 'none'),
    round(sum(s.v * l.amount * t.fx_rate), 2),
    round(sum(s.v * l.tax_amount * t.fx_rate), 2)
  from public.transactions t
  join public.transaction_lines l on l.transaction_id = t.id
  left join public.tax_codes tc on tc.id = l.tax_code_id
  cross join lateral (select case when t.type in ('credit_note', 'vendor_credit') then -1 else 1 end v) s
  where t.book = public.current_book() and t.voided_at is null and not t.is_draft
    and t.type in ('invoice', 'sales_receipt', 'credit_note', 'bill', 'expense', 'vendor_credit')
    and t.date between p_from and p_to
  group by 1, 2
  order by 1 desc, 2
$$;

revoke execute on function public.gst_schedule(uuid) from public, anon;
revoke execute on function public._gst_schedule_now(uuid) from public, anon;
revoke execute on function public.snapshot_gst_schedule() from public, anon, authenticated;
grant execute on function public._gst_schedule_now(uuid) to authenticated;
revoke execute on function public.gst_supplies(date, date) from public, anon;
grant execute on function public.gst_schedule(uuid) to authenticated;
grant execute on function public.gst_supplies(date, date) to authenticated;

/** A new due day applies to every return not yet filed. */
create or replace function public.sync_gst_due_dates() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.gst_due_day is distinct from old.gst_due_day then
    update public.tax_periods
      set due_date = make_date(extract(year from end_date + 1)::int, extract(month from end_date + 1)::int, new.gst_due_day)
      where status = 'open';
  end if;
  return new;
end $$;
revoke execute on function public.sync_gst_due_dates() from public, anon, authenticated;
create trigger settings_gst_due_day after update of gst_due_day on public.settings
  for each row execute function public.sync_gst_due_dates();
