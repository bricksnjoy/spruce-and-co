-- 008 · GST by quarter (§8). Every GST journal line belongs to a return period.
-- Filing freezes that period's lines; anything dated in a filed period, or a
-- change to a document already filed, goes into the next open return as an
-- adjustment (decision G4). Filing posts the settlement; paying MIRA closes it.

create table public.tax_periods (
  id uuid primary key default gen_random_uuid(),
  tax text not null default 'gst' check (tax = 'gst'),
  start_date date not null,
  end_date date not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'filed', 'paid')),
  filed_at timestamptz,
  filed_by uuid,
  return_reference text,
  -- what was filed, kept as it was on the day
  output_total numeric(18,2),
  input_total numeric(18,2),
  net numeric(18,2),
  settlement_transaction_id uuid references public.transactions,
  payment_transaction_id uuid references public.transactions,
  book text not null default public.current_book() check (book in ('live', 'sandbox')),
  created_at timestamptz not null default now(),
  unique (book, tax, start_date),
  check (end_date >= start_date)
);
alter table public.journal_lines add constraint journal_lines_tax_period_fk foreign key (tax_period_id) references public.tax_periods;
alter table public.transactions add constraint transactions_tax_period_fk foreign key (tax_period_id) references public.tax_periods;

/** The return a GST line dated `p_date` belongs in: its own period, or the next open one if that is filed. */
create or replace function public.gst_period_for(p_date date, p_book text default public.current_book()) returns uuid language plpgsql as $$
declare m int := (select gst_period_months from public.settings where id); dd int := (select gst_due_day from public.settings where id);
  d date := p_date; s date; e date; v public.tax_periods;
begin
  loop
    s := make_date(extract(year from d)::int, ((extract(month from d)::int - 1) / m) * m + 1, 1);
    e := (s + make_interval(months => m) - interval '1 day')::date;
    select * into v from public.tax_periods where tax = 'gst' and start_date = s and book = p_book;
    if not found then
      insert into public.tax_periods (start_date, end_date, due_date, book)
      values (s, e, make_date(extract(year from e + 1)::int, extract(month from e + 1)::int, dd), p_book)
      returning * into v;
    end if;
    if v.status = 'open' then return v.id; end if;
    d := e + 1;
  end loop;
end $$;

create or replace function public._line_frozen(p_period uuid) returns boolean language sql stable as $$
  select p_period is not null and exists (select 1 from public.tax_periods where id = p_period and status in ('filed', 'paid'))
$$;

/**
 * After posting: new GST lines go to their return period. If the document
 * already had GST in a filed return, only the difference is posted, into the
 * next open return, and the filed lines stay exactly as filed.
 */
create or replace function public._gst_after_post(p_id uuid) returns void language plpgsql as $$
declare t public.transactions; acc uuid; v_new numeric; v_frozen numeric; v_period uuid; d numeric;
begin
  select * into t from public.transactions where id = p_id;
  if t.type in ('gst_settlement', 'gst_payment') then return; end if;
  for acc in select id from public.accounts where subtype in ('gst_output', 'gst_input') loop
    select coalesce(sum(home_debit - home_credit), 0) into v_new from public.journal_lines
      where transaction_id = p_id and account_id = acc and tax_period_id is null;
    select coalesce(sum(home_debit - home_credit), 0) into v_frozen from public.journal_lines
      where transaction_id = p_id and account_id = acc and tax_period_id is not null and public._line_frozen(tax_period_id);
    if not exists (select 1 from public.journal_lines where transaction_id = p_id and account_id = acc) then continue; end if;
    v_period := public.gst_period_for(t.date, t.book);
    if v_frozen = 0 then
      update public.journal_lines set tax_period_id = v_period where transaction_id = p_id and account_id = acc and tax_period_id is null;
    else
      delete from public.journal_lines where transaction_id = p_id and account_id = acc and tax_period_id is null;
      d := v_new - v_frozen;
      if d <> 0 then
        insert into public.journal_lines (transaction_id, line_no, date, account_id, debit, credit, home_debit, home_credit,
          contact_id, project_id, tax_period_id, memo, book)
        values (p_id, (select coalesce(max(line_no), 0) + 1 from public.journal_lines where transaction_id = p_id), t.date, acc,
          greatest(d, 0), greatest(-d, 0), greatest(d, 0), greatest(-d, 0), t.contact_id, t.project_id, v_period,
          'Adjustment to a filed GST return', t.book);
      end if;
    end if;
  end loop;
end $$;

/** Filed GST lines never change. */
create or replace function public.guard_filed_gst() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and public._purging() and old.book = 'sandbox' then return old; end if;
  if public._line_frozen(old.tax_period_id) then
    raise exception 'That GST return is filed; its lines cannot change. Corrections go into the next open return.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger journal_lines_filed_gst before update or delete on public.journal_lines
  for each row execute function public.guard_filed_gst();

/** A period's output tax, input tax and net, from its lines (settlement excluded). */
create or replace function public.gst_totals(p_period uuid, out output numeric, out input numeric, out net numeric) language sql stable as $$
  select
    coalesce(sum(case when a.subtype = 'gst_output' then j.home_credit - j.home_debit end), 0),
    coalesce(sum(case when a.subtype = 'gst_input' then j.home_debit - j.home_credit end), 0),
    coalesce(sum(case when a.subtype = 'gst_output' then j.home_credit - j.home_debit end), 0)
      - coalesce(sum(case when a.subtype = 'gst_input' then j.home_debit - j.home_credit end), 0)
  from public.journal_lines j
  join public.accounts a on a.id = j.account_id
  join public.transactions t on t.id = j.transaction_id
  where j.tax_period_id = p_period and a.subtype in ('gst_output', 'gst_input') and t.type <> 'gst_settlement'
$$;

/** What is still owed to MIRA for a filed period. */
create or replace function public.gst_payable(p_period uuid) returns numeric language sql stable as $$
  select coalesce(sum(j.home_credit - j.home_debit), 0)
  from public.journal_lines j join public.accounts a on a.id = j.account_id
  where j.tax_period_id = p_period and a.subtype = 'gst_payable'
$$;

/**
 * File a return (§8 steps 3–4): freeze the period and post the settlement —
 * Dr output, Cr input, Cr GST Payable – MIRA for the net. A credit is carried
 * forward (decision G3) and used against the next payable return.
 */
create or replace function public.file_gst_period(p_period uuid, p_reference text default null) returns uuid language plpgsql as $$
declare v public.tax_periods; tot record; v_txn uuid; cf numeric; used numeric := 0; n int := 0;
begin
  select * into v from public.tax_periods where id = p_period for update;
  if v.status <> 'open' then raise exception 'This return is already filed'; end if;
  if exists (select 1 from public.tax_periods where tax = 'gst' and book = v.book and start_date < v.start_date and status = 'open'
             and exists (select 1 from public.journal_lines where tax_period_id = tax_periods.id)) then
    raise exception 'File the earlier return first';
  end if;
  select * into tot from public.gst_totals(p_period);
  update public.tax_periods set status = 'filed', filed_at = now(), filed_by = auth.uid(), return_reference = nullif(trim(p_reference), ''),
    output_total = tot.output, input_total = tot.input, net = tot.net where id = p_period;

  if tot.output = 0 and tot.input = 0 then
    update public.tax_periods set status = 'paid' where id = p_period;
    return null;
  end if;
  insert into public.transactions (type, date, tax_period_id, memo, book)
  values ('gst_settlement', v.end_date, p_period, 'GST return ' || to_char(v.start_date, 'Mon') || '–' || to_char(v.end_date, 'Mon YYYY'), v.book)
  returning id into v_txn;
  n := n + 1;
  insert into public.transaction_lines (transaction_id, line_no, account_id, debit, credit)
  values (v_txn, n, public.acct('gst_output'), greatest(tot.output, 0), greatest(-tot.output, 0));
  n := n + 1;
  insert into public.transaction_lines (transaction_id, line_no, account_id, debit, credit)
  values (v_txn, n, public.acct('gst_input'), greatest(-tot.input, 0), greatest(tot.input, 0));
  if tot.net > 0 then
    select coalesce(sum(home_debit - home_credit), 0) into cf from public.journal_lines where account_id = public.acct('gst_refund');
    used := least(tot.net, greatest(cf, 0));
    if used > 0 then
      n := n + 1;
      insert into public.transaction_lines (transaction_id, line_no, account_id, credit, description)
      values (v_txn, n, public.acct('gst_refund'), used, 'Carried-forward credit used');
    end if;
    if tot.net - used > 0 then
      n := n + 1;
      insert into public.transaction_lines (transaction_id, line_no, account_id, credit) values (v_txn, n, public.acct('gst_payable'), tot.net - used);
    end if;
  elsif tot.net < 0 then
    n := n + 1;
    insert into public.transaction_lines (transaction_id, line_no, account_id, debit, description)
    values (v_txn, n, public.acct('gst_refund'), -tot.net, 'Credit carried forward');
  end if;
  delete from public.transaction_lines where transaction_id = v_txn and debit = 0 and credit = 0;
  perform public.post_transaction(v_txn);
  update public.tax_periods set settlement_transaction_id = v_txn,
    status = case when tot.net - used <= 0 then 'paid' else 'filed' end where id = p_period;
  return v_txn;
end $$;

/** Pay MIRA for a filed return (§8 step 5). */
create or replace function public.pay_gst_period(p_period uuid, p_bank uuid, p_date date, p_amount numeric default null) returns uuid language plpgsql as $$
declare v public.tax_periods; owed numeric; amt numeric; v_txn uuid;
begin
  select * into v from public.tax_periods where id = p_period for update;
  if v.status = 'open' then raise exception 'File the return before paying it'; end if;
  owed := public.gst_payable(p_period);
  amt := coalesce(p_amount, owed);
  if amt <= 0 then raise exception 'Nothing is owed on this return'; end if;
  if amt > owed then raise exception 'That is more than the % owed on this return', owed; end if;
  insert into public.transactions (type, date, bank_account_id, total_amount, tax_period_id, memo, book)
  values ('gst_payment', p_date, p_bank, amt, p_period, 'GST paid to MIRA', v.book) returning id into v_txn;
  perform public.post_transaction(v_txn);
  update public.tax_periods set payment_transaction_id = v_txn,
    status = case when public.gst_payable(p_period) = 0 then 'paid' else 'filed' end where id = p_period;
  return v_txn;
end $$;

create or replace view public.gst_periods_v as
select p.id, p.book, p.start_date, p.end_date, p.due_date, p.status, p.return_reference, p.filed_at,
  case when p.status = 'open' then t.output else p.output_total end as output,
  case when p.status = 'open' then t.input else p.input_total end as input,
  case when p.status = 'open' then t.net else p.net end as net,
  public.gst_payable(p.id) as payable,
  -- lines dated before the period: late documents and changes to filed returns
  (select coalesce(sum(j.home_credit - j.home_debit), 0) from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.tax_period_id = p.id and j.date < p.start_date and a.subtype = 'gst_output') as prior_output_adjustments,
  (select coalesce(sum(j.home_debit - j.home_credit), 0) from public.journal_lines j join public.accounts a on a.id = j.account_id
    where j.tax_period_id = p.id and j.date < p.start_date and a.subtype = 'gst_input') as prior_input_adjustments
from public.tax_periods p cross join lateral public.gst_totals(p.id) t;

create trigger tax_periods_audit after insert or update or delete on public.tax_periods for each row execute function public.log_change();
