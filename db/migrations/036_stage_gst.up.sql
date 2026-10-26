-- 036 · A project whose value carries GST (projects.gst_amount, worked out from the standard rate
-- when the project is saved) has its billing stages invoiced with standard-rated GST on top, even
-- while the company is not marked GST registered in Settings.
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
  -- GST is charged when the company is registered, or when the project carries GST on its value (036)
  select coalesce(gst_registered, false) or coalesce(p.gst_amount, 0) > 0 into reg from public.settings where id;
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
