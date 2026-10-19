-- 019 · Sales (Phase 4, module 4).
-- • A billing stage becomes an invoice for its share of the revised contract.
-- • Receipts waiting in Undeposited Funds are banked with a deposit that
--   records which receipts it carries, so none is banked twice.
-- • Voiding an invoice frees its billing stage; voiding a deposit frees its receipts.
-- • One list of sales documents with the customer, project and derived status.

alter table public.transactions add column if not exists deposited_in uuid references public.transactions;
create index if not exists transactions_deposited_in on public.transactions (deposited_in) where deposited_in is not null;

/** Invoice a billing stage: one line for the stage's share of the revised contract. */
create or replace function public.invoice_stage(p_stage uuid, p_date date, p_due date default null) returns uuid
language plpgsql set search_path = public, pg_temp as $$
declare st public.billing_stages; p public.projects; f public.project_figures_t; amt numeric; v_id uuid; v_code uuid; reg boolean;
begin
  select * into st from public.billing_stages where id = p_stage for update;
  if not found then raise exception 'No such billing stage'; end if;
  if st.invoice_id is not null then raise exception 'This stage is already invoiced'; end if;
  select * into p from public.projects where id = st.project_id;
  if p.customer_id is null then raise exception 'Choose the project''s customer before invoicing it'; end if;
  f := public.project_figures(p.id);
  amt := case when st.basis = 'percent' then round(f.revised * st.value / 100, 2) else round(st.value, 2) end;
  if amt <= 0 then raise exception 'This stage comes to nothing; check the contract value'; end if;
  -- GST follows the company's registration
  select coalesce(gst_registered, false) into reg from public.settings where id;
  select id into v_code from public.tax_codes where code = case when reg then 'STD' else 'OOS' end;
  insert into public.transactions (type, date, due_date, number, contact_id, project_id, memo, book)
  values ('invoice', p_date, coalesce(p_due, p_date + coalesce((select terms_days from public.contacts where id = p.customer_id), 0)),
    public.next_doc_number('invoice', p_date), p.customer_id, p.id, st.name, p.book)
  returning id into v_id;
  insert into public.transaction_lines (transaction_id, line_no, description, amount, tax_code_id, project_id, account_id)
  values (v_id, 1, p.name || ' — ' || st.name || case when st.basis = 'percent' then ' (' || trim(to_char(st.value, 'FM990.####')) || '% of contract)' else '' end,
    amt, v_code, p.id, public.acct('contract_revenue'));
  perform public.post_transaction(v_id);
  update public.billing_stages set invoice_id = v_id where id = p_stage;
  return v_id;
end $$;

/** Bank receipts from Undeposited Funds: one deposit carrying exactly the receipts chosen. */
create or replace function public.make_deposit(p_bank uuid, p_date date, p_receipts uuid[], p_memo text default null) returns uuid
language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; v_total numeric := 0; r record; n int := 0; v_book text := public.current_book();
begin
  if coalesce(array_length(p_receipts, 1), 0) = 0 then raise exception 'Choose the receipts to deposit'; end if;
  for r in select t.* from public.transactions t where t.id = any (p_receipts) for update loop
    n := n + 1;
    if r.book <> v_book then raise exception 'That belongs to the other book (Live and Test are never mixed)'; end if;
    if r.voided_at is not null or r.is_draft then raise exception 'Only posted receipts can be deposited'; end if;
    if r.deposited_in is not null then raise exception '% is already deposited', coalesce(r.number, 'A receipt'); end if;
    if not exists (select 1 from public.journal_lines where transaction_id = r.id and account_id = public.acct('undeposited') and home_debit > 0) then
      raise exception '% did not go to Undeposited Funds', coalesce(r.number, 'A receipt');
    end if;
    if r.date > p_date then raise exception 'A deposit cannot be dated before a receipt it carries (%)', coalesce(r.number, ''); end if;
    select v_total + sum(home_debit - home_credit) into v_total from public.journal_lines where transaction_id = r.id and account_id = public.acct('undeposited');
  end loop;
  if n <> array_length(p_receipts, 1) then raise exception 'Some receipts were not found'; end if;
  insert into public.transactions (type, date, bank_account_id, total_amount, memo, book)
  values ('deposit', p_date, p_bank, v_total, coalesce(p_memo, 'Deposit of ' || n || ' receipt' || case when n = 1 then '' else 's' end), v_book)
  returning id into v_id;
  perform public.post_transaction(v_id);
  update public.transactions set deposited_in = v_id where id = any (p_receipts);
  return v_id;
end $$;

/** What voiding frees up: the billing stage an invoice came from, the receipts a deposit carried. */
create or replace function public.release_on_void() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    update public.billing_stages set invoice_id = null where invoice_id = new.id;
    if new.type = 'deposit' then update public.transactions set deposited_in = null where deposited_in = new.id; end if;
    if new.deposited_in is not null then raise exception 'This receipt is in a bank deposit; void the deposit first'; end if;
  end if;
  return new;
end $$;
create trigger transactions_release_on_void before update of voided_at on public.transactions
  for each row execute function public.release_on_void();

/** Sales documents with customer, project and status, for the Sales lists. */
create or replace view public.sales_list_v with (security_invoker = on) as
select b.id, b.book, b.type, b.number, b.date, b.due_date, b.total, b.applied, b.applied_from, b.balance,
  b.is_draft, b.sent_at, b.voided_at, b.contact_id, c.name as customer_name, b.project_id, p.code as project_code,
  public.document_status(b.id) as status, t.memo, t.currency, t.deposited_in
from public.document_balances_v b
join public.transactions t on t.id = b.id
left join public.contacts c on c.id = b.contact_id
left join public.projects p on p.id = b.project_id
where b.type in ('invoice', 'credit_note', 'sales_receipt', 'customer_payment', 'customer_advance', 'advance_application', 'bad_debt', 'deposit');

/** Money received against invoices since a date (the money bar's "Paid"). */
create or replace function public.sales_paid_since(p_since date) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(a.amount), 0) from public.applications a
  join public.transactions f on f.id = a.from_transaction_id
  join public.transactions t on t.id = a.to_transaction_id
  where t.type = 'invoice' and f.type in ('customer_payment', 'advance_application') and f.voided_at is null and f.date >= p_since
$$;

-- the doors the screens use
create or replace function public.rpc_invoice_stage(p_stage uuid, p_date date, p_due date default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  perform public._require_book((select p.book from public.billing_stages s join public.projects p on p.id = s.project_id where s.id = p_stage));
  return public.invoice_stage(p_stage, p_date, p_due);
end $$;

create or replace function public.rpc_make_deposit(p_bank uuid, p_date date, p_receipts uuid[], p_memo text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role('write');
  return public.make_deposit(p_bank, p_date, p_receipts, p_memo);
end $$;

revoke execute on function public.invoice_stage(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.make_deposit(uuid, date, uuid[], text) from public, anon, authenticated;
revoke execute on function public.release_on_void() from public, anon, authenticated;
revoke execute on function public.rpc_invoice_stage(uuid, date, date) from public, anon;
revoke execute on function public.rpc_make_deposit(uuid, date, uuid[], text) from public, anon;
revoke execute on function public.sales_paid_since(date) from public, anon;
grant execute on function public.rpc_invoice_stage(uuid, date, date) to authenticated;
grant execute on function public.rpc_make_deposit(uuid, date, uuid[], text) to authenticated;
grant execute on function public.sales_paid_since(date) to authenticated;
revoke all on public.sales_list_v from anon;
