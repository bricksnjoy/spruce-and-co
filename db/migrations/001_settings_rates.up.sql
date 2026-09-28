-- 001 · Settings, currencies, dated rates, tax codes, document numbering.
-- Rates are never hard-coded: every GST, pension, withholding-tax and BPT rate
-- lives in `rates` with the date it took effect.

create table public.settings (
  id boolean primary key default true check (id),
  closing_date date,
  closing_date_set_at timestamptz,
  fiscal_year_start_month int not null default 1 check (fiscal_year_start_month between 1 and 12),
  gst_registered boolean not null default false,
  gst_period_months int not null default 3 check (gst_period_months in (1, 3)),
  gst_due_day int not null default 28 check (gst_due_day between 1 and 28),
  recognition_default text not null default 'billing' check (recognition_default in ('billing', 'poc')),
  profit_share_debit text not null default 'expense' check (profit_share_debit in ('expense', 'dividends')),
  approval_limit_bill numeric(18,2),
  home_currency char(3) not null default 'MVR',
  opening_balance_date date not null default '2026-01-01',
  nopay_days_divisor numeric(5,2) not null default 30 check (nopay_days_divisor > 0),
  updated_at timestamptz not null default now()
);
insert into public.settings (gst_registered) select coalesce((select gst_registered from public.company where id), false);

create table public.currencies (
  code char(3) primary key,
  name text not null,
  active boolean not null default true
);
insert into public.currencies (code, name) values ('MVR', 'Maldivian Rufiyaa'), ('USD', 'US Dollar');

create table public.exchange_rates (
  currency char(3) not null references public.currencies,
  rate_date date not null,
  rate numeric(18,6) not null check (rate > 0),
  primary key (currency, rate_date)
);

create table public.rates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('gst', 'pension_employee', 'pension_employer', 'wht', 'bpt')),
  code text not null default 'default',
  value numeric(9,4),
  -- for bracketed taxes: [{"from": 0, "to": 500000, "rate": 0}, {"from": 500000, "to": null, "rate": 15}]
  brackets jsonb,
  effective_from date not null,
  created_at timestamptz not null default now(),
  unique (kind, code, effective_from),
  check (value is not null or brackets is not null)
);
insert into public.rates (kind, code, value, effective_from) values
  -- 6% is the rate the app has used for bills before 2023; earlier history is not needed (go-live 2026)
  ('gst', 'STD', 6, '2000-01-01'),
  ('gst', 'STD', 8, '2023-01-01'),
  ('gst', 'ZERO', 0, '2000-01-01'),
  -- decision Y3: 7% + 7%, Maldivian staff only (to be confirmed before the first payroll run)
  ('pension_employee', 'default', 7, '2020-01-01'),
  ('pension_employer', 'default', 7, '2020-01-01');
insert into public.rates (kind, code, brackets, effective_from) values
  ('bpt', 'default', '[{"from": 0, "to": 500000, "rate": 0}, {"from": 500000, "to": null, "rate": 15}]', '2020-01-01');
-- withholding-tax brackets are not seeded: decision Y4 needs your figures first

create table public.tax_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('standard', 'zero', 'exempt', 'out_of_scope')),
  rate_code text,
  active boolean not null default true
);
insert into public.tax_codes (code, name, kind, rate_code) values
  ('STD', 'Standard rated', 'standard', 'STD'),
  ('ZERO', 'Zero rated', 'zero', 'ZERO'),
  ('EXEMPT', 'Exempt', 'exempt', null),
  ('OOS', 'Out of scope', 'out_of_scope', null);

/** The value of a dated rate on a day. */
create or replace function public.rate_value(p_kind text, p_code text, p_date date)
returns numeric language sql stable as $$
  select value from public.rates
  where kind = p_kind and code = p_code and effective_from <= p_date and value is not null
  order by effective_from desc limit 1
$$;

create or replace function public.rate_brackets(p_kind text, p_code text, p_date date)
returns jsonb language sql stable as $$
  select brackets from public.rates
  where kind = p_kind and code = p_code and effective_from <= p_date and brackets is not null
  order by effective_from desc limit 1
$$;

/** Tax on an amount under progressive brackets. */
create or replace function public.bracket_tax(p_amount numeric, p_brackets jsonb)
returns numeric language sql immutable as $$
  select coalesce(round(sum(
    greatest(0, least(p_amount, coalesce((b ->> 'to')::numeric, p_amount)) - (b ->> 'from')::numeric)
    * (b ->> 'rate')::numeric / 100), 2), 0)
  from jsonb_array_elements(coalesce(p_brackets, '[]'::jsonb)) b
  where p_amount > (b ->> 'from')::numeric
$$;

/** The GST rate of a tax code on a day (0 for exempt and out of scope). */
create or replace function public.tax_rate(p_tax_code uuid, p_date date)
returns numeric language sql stable as $$
  select coalesce((select public.rate_value('gst', tc.rate_code, p_date) from public.tax_codes tc where tc.id = p_tax_code), 0)
$$;

create table public.document_sequences (
  type text primary key,
  prefix text not null,
  next_number int not null default 1 check (next_number > 0),
  pad int not null default 3 check (pad between 1 and 8)
);
insert into public.document_sequences (type, prefix) values
  ('estimate', 'SC-Q/{YY}/'), ('invoice', 'SC-INV/{YY}/'), ('credit_note', 'SC-CN/{YY}/'),
  ('sales_receipt', 'SC-SR/{YY}/'), ('customer_payment', 'SC-PAY/{YY}/'), ('bill', 'SC-BILL/{YY}/'),
  ('purchase_order', 'SC-PO/{YY}/'), ('bill_payment', 'SC-BP/{YY}/'), ('journal', 'SC-JE/{YY}/'),
  ('payout', 'SC-OUT/{YY}/'), ('payroll_run', 'SC-PR/{YY}/'), ('distribution', 'SC-DIST/{YY}/');

/** Take the next number for a document type; the row lock makes two users at once safe. */
create or replace function public.next_doc_number(p_type text, p_date date)
returns text language plpgsql as $$
declare s public.document_sequences;
begin
  update public.document_sequences set next_number = next_number + 1 where type = p_type returning * into s;
  if not found then return null; end if;
  return replace(s.prefix, '{YY}', to_char(p_date, 'YY')) || lpad((s.next_number - 1)::text, s.pad, '0');
end $$;

alter table public.profiles add column if not exists can_payroll boolean not null default false;

create trigger settings_audit after insert or update or delete on public.settings for each row execute function public.log_change();
create trigger rates_audit after insert or update or delete on public.rates for each row execute function public.log_change();
create trigger tax_codes_audit after insert or update or delete on public.tax_codes for each row execute function public.log_change();
