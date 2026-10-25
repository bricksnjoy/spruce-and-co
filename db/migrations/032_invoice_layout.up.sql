-- The printed invoice as Spruce & Co send it: the client's agreement and PO numbers in the
-- header, and each line's own item number (1.0, 1.1, A …) and unit. Headings are lines with no amount.
alter table public.transactions add column if not exists agr_no text;
alter table public.transactions add column if not exists po_no text;
alter table public.transaction_lines add column if not exists item_no text;
alter table public.transaction_lines add column if not exists unit text;

create or replace function public.rpc_save_transaction(p jsonb) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid; v_type public.txn_type := (p ->> 'type')::public.txn_type; t public.transactions;
  l jsonb; a jsonb; i int := 0; v_date date := (p ->> 'date')::date;
begin
  if v_type in ('payroll_run', 'distribution', 'gst_settlement', 'gst_payment', 'wip_adjustment', 'fx_revaluation', 'depreciation') then
    raise exception 'That is created by its own screen, not saved directly';
  end if;
  perform public.require_role(case when public._payroll_type(v_type) then 'payroll' else 'write' end);
  if v_date is null then raise exception 'Enter the date'; end if;
  if v_id is not null then
    select * into t from public.transactions where id = v_id for update;
    perform public._require_book(t.book);
    if t.voided_at is not null then raise exception 'A void document cannot be changed'; end if;
    if t.type <> v_type then raise exception 'A document cannot change its type'; end if;
    update public.transactions set date = v_date, number = coalesce(nullif(p ->> 'number', ''), number),
      due_date = (p ->> 'due_date')::date, contact_id = (p ->> 'contact_id')::uuid, project_id = (p ->> 'project_id')::uuid,
      employee_id = (p ->> 'employee_id')::uuid, bank_account_id = (p ->> 'bank_account_id')::uuid, total_amount = (p ->> 'total_amount')::numeric,
      currency = coalesce(p ->> 'currency', 'MVR'), fx_rate = coalesce((p ->> 'fx_rate')::numeric, 1), memo = p ->> 'memo', reference = p ->> 'reference',
      terms_days = (p ->> 'terms_days')::int, supplier_tin = p ->> 'supplier_tin', tax_invoice_no = p ->> 'tax_invoice_no',
      tax_invoice_date = (p ->> 'tax_invoice_date')::date, customs_ref = p ->> 'customs_ref', is_draft = coalesce((p ->> 'is_draft')::boolean, false),
      agr_no = p ->> 'agr_no', po_no = p ->> 'po_no', updated_at = now()
    where id = v_id;
    delete from public.applications where from_transaction_id = v_id;
    delete from public.transaction_lines where transaction_id = v_id;
  else
    insert into public.transactions (type, date, number, due_date, contact_id, project_id, employee_id, bank_account_id, total_amount,
      currency, fx_rate, memo, reference, terms_days, supplier_tin, tax_invoice_no, tax_invoice_date, customs_ref, is_draft, agr_no, po_no)
    values (v_type, v_date, coalesce(nullif(p ->> 'number', ''), public.next_doc_number(v_type::text, v_date)),
      (p ->> 'due_date')::date, (p ->> 'contact_id')::uuid, (p ->> 'project_id')::uuid, (p ->> 'employee_id')::uuid,
      (p ->> 'bank_account_id')::uuid, (p ->> 'total_amount')::numeric, coalesce(p ->> 'currency', 'MVR'), coalesce((p ->> 'fx_rate')::numeric, 1),
      p ->> 'memo', p ->> 'reference', (p ->> 'terms_days')::int, p ->> 'supplier_tin', p ->> 'tax_invoice_no',
      (p ->> 'tax_invoice_date')::date, p ->> 'customs_ref', coalesce((p ->> 'is_draft')::boolean, false), p ->> 'agr_no', p ->> 'po_no')
    returning id into v_id;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    i := i + 1;
    insert into public.transaction_lines (transaction_id, line_no, item_id, account_id, description, qty, rate, amount, tax_code_id, tax_amount,
      gst_claimable, project_id, employee_id, contact_id, component, debit, credit, item_no, unit)
    values (v_id, i, (l ->> 'item_id')::uuid, (l ->> 'account_id')::uuid, l ->> 'description', (l ->> 'qty')::numeric, (l ->> 'rate')::numeric,
      coalesce((l ->> 'amount')::numeric, 0), (l ->> 'tax_code_id')::uuid, coalesce((l ->> 'tax_amount')::numeric, 0),
      coalesce((l ->> 'gst_claimable')::boolean, false), (l ->> 'project_id')::uuid, (l ->> 'employee_id')::uuid, (l ->> 'contact_id')::uuid,
      l ->> 'component', coalesce((l ->> 'debit')::numeric, 0), coalesce((l ->> 'credit')::numeric, 0), l ->> 'item_no', l ->> 'unit');
  end loop;
  for a in select * from jsonb_array_elements(coalesce(p -> 'applications', '[]')) loop
    insert into public.applications (from_transaction_id, to_transaction_id, amount) values (v_id, (a ->> 'to')::uuid, (a ->> 'amount')::numeric);
  end loop;
  perform public.post_transaction(v_id);
  return v_id;
end $$;
