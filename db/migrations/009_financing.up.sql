-- 009 · Project financing and the profit split (§5, §6).
-- Financing is the posted loans and capital-pool contributions tagged to a
-- project. On completion the split is worked out in laari from the project's
-- actual profit and posted as one distribution; later bad debts and late
-- entries post adjustment distributions, never edits. Payouts wait until the
-- client owes nothing.

create table public.profit_schemes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  effective_from date not null unique,
  created_at timestamptz not null default now()
);

create table public.scheme_allocations (
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references public.profit_schemes on delete cascade,
  party_type text not null check (party_type in ('financing_pool', 'company', 'person')),
  contact_id uuid references public.contacts,
  percent numeric(7,4) not null check (percent > 0 and percent <= 100),
  sort_order int not null default 0,
  check ((party_type = 'person') = (contact_id is not null))
);
create unique index scheme_allocations_one_pool on public.scheme_allocations (scheme_id, party_type) where party_type <> 'person';
create unique index scheme_allocations_one_person on public.scheme_allocations (scheme_id, contact_id) where contact_id is not null;

create or replace function public.check_scheme_total() returns trigger language plpgsql as $$
declare v uuid := coalesce(new.scheme_id, old.scheme_id); t numeric;
begin
  if not exists (select 1 from public.profit_schemes where id = v) then return null; end if;
  select coalesce(sum(percent), 0) into t from public.scheme_allocations where scheme_id = v;
  if t <> 100 then raise exception 'A profit-share scheme must total 100%% (this one totals %)', t using errcode = 'P0001'; end if;
  return null;
end $$;
create constraint trigger scheme_allocations_total after insert or update or delete on public.scheme_allocations
  deferrable initially deferred for each row execute function public.check_scheme_total();

-- today's scheme (20 / 30 / 25 / 10 / 10 / 5), each person linked by id rather than by name (audit A-11)
insert into public.profit_schemes (name, effective_from) values ('Current scheme', '2020-01-01');
insert into public.scheme_allocations (scheme_id, party_type, contact_id, percent, sort_order)
select (select id from public.profit_schemes), case ps.kind when 'investors' then 'financing_pool' when 'company' then 'company' else 'person' end,
  case when ps.kind = 'person' then (
    select c.id from public.contacts c where 'partner' = any (c.kinds) and ps.name ilike c.name || '%' order by length(c.name) desc limit 1) end,
  ps.pct, ps.sort_order
from public.profit_shares ps where ps.active;
do $$ begin
  if exists (select 1 from public.scheme_allocations where party_type = 'person' and contact_id is null) then
    raise exception 'A profit share could not be matched to a partner';
  end if;
end $$;

alter table public.projects add constraint projects_scheme_fk foreign key (scheme_id) references public.profit_schemes;

/** The scheme in force on a date. */
create or replace function public.scheme_on(p_date date) returns uuid language sql stable as $$
  select id from public.profit_schemes where effective_from <= p_date order by effective_from desc limit 1
$$;

/** A project uses the scheme in force when it starts (decision P6). */
create or replace function public.set_project_scheme() returns trigger language plpgsql as $$
begin
  if new.scheme_id is null then new.scheme_id := public.scheme_on(coalesce(new.start_date, current_date)); end if;
  return new;
end $$;
create trigger projects_scheme before insert or update of start_date, scheme_id on public.projects
  for each row execute function public.set_project_scheme();
update public.projects set scheme_id = public.scheme_on(coalesce(start_date, current_date)) where scheme_id is null;

/** Each financing source of a project: principal received and repaid, from the ledger. */
create or replace view public.project_financing_v as
select j.project_id, j.contact_id,
  case par.subtype when 'project_loans' then 'external' else 'capital_pool' end as source_type,
  sum(j.home_credit) as received,
  sum(j.home_debit) as repaid,
  sum(j.home_credit - j.home_debit) as outstanding
from public.journal_lines j
join public.accounts a on a.id = j.account_id
join public.accounts par on par.id = a.parent_id
where par.subtype in ('project_loans', 'capital_pool_loans') and j.project_id is not null
group by j.project_id, j.contact_id, par.subtype;

create table public.distributions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects,
  scheme_id uuid not null references public.profit_schemes,
  profit_amount numeric(18,2) not null,
  reason text not null check (reason in ('completion', 'bad_debt', 'late_entry', 'manual')),
  status text not null default 'posted' check (status in ('posted')),
  journal_transaction_id uuid references public.transactions,
  adjusts_distribution_id uuid references public.distributions,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index distributions_one_completion on public.distributions (project_id) where reason = 'completion';

create table public.distribution_lines (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.distributions on delete cascade,
  contact_id uuid not null references public.contacts,
  component text not null check (component in ('financing_return', 'profit_share')),
  amount numeric(18,2) not null
);

/**
 * The split (§5), in laari. The financing pool's share is divided among the
 * project's financing sources by amount (P4); each person's fixed share
 * applies whether or not they financed it. The company's share and every
 * rounding remainder are not posted: they stay as profit. A loss or zero
 * profit gives nothing (P2).
 */
create or replace function public.split_profit(p_project uuid, p_profit numeric)
returns table (contact_id uuid, party_type text, component text, amount numeric) language plpgsql stable as $$
declare
  v_scheme uuid; profit_l bigint; pool_pct numeric; pool_l bigint; fin_total numeric; s record;
begin
  if coalesce(p_profit, 0) <= 0 then return; end if;
  select coalesce(p.scheme_id, public.scheme_on(coalesce(p.start_date, current_date))) into v_scheme from public.projects p where p.id = p_project;
  profit_l := round(p_profit * 100)::bigint;
  select coalesce(sum(sa.percent), 0) into pool_pct from public.scheme_allocations sa where sa.scheme_id = v_scheme and sa.party_type = 'financing_pool';
  pool_l := floor(profit_l * pool_pct / 100)::bigint;
  select coalesce(sum(f.received), 0) into fin_total from public.project_financing_v f where f.project_id = p_project;
  if fin_total > 0 and pool_l > 0 then
    for s in select f.contact_id cid, f.received from public.project_financing_v f join public.contacts c on c.id = f.contact_id
             where f.project_id = p_project and f.received > 0 order by f.received desc, c.name loop
      contact_id := s.cid; party_type := 'financing_pool'; component := 'financing_return';
      amount := floor(pool_l * s.received / fin_total)::bigint / 100.0;
      if amount > 0 then return next; end if;
    end loop;
  end if;
  for s in select sa.contact_id cid, sa.percent from public.scheme_allocations sa where sa.scheme_id = v_scheme and sa.party_type = 'person' order by sa.sort_order loop
    contact_id := s.cid; party_type := 'person'; component := 'profit_share';
    amount := floor(profit_l * s.percent / 100)::bigint / 100.0;
    if amount > 0 then return next; end if;
  end loop;
end $$;

/** The split a project would get if completed now, for the confirmation preview (§6). */
create or replace function public.preview_split(p_project uuid)
returns table (contact_id uuid, name text, component text, amount numeric, principal numeric) language sql stable as $$
  select s.contact_id, c.name, s.component, s.amount,
    coalesce((select sum(f.outstanding) from public.project_financing_v f where f.project_id = p_project and f.contact_id = s.contact_id), 0)
  from public.split_profit(p_project, public.project_profit(p_project)) s join public.contacts c on c.id = s.contact_id
$$;

/** Post a distribution's lines: Finance Cost and Profit Share (or Dividends) against each person's payables. */
create or replace function public._post_distribution(p_dist uuid, p_date date) returns uuid language plpgsql as $$
declare d public.distributions; l record; v_txn uuid; n int := 0; share_acct uuid; v_date date;
begin
  select * into d from public.distributions where id = p_dist;
  if not exists (select 1 from public.distribution_lines where distribution_id = p_dist and amount <> 0) then return null; end if;
  share_acct := public.acct(case when (select profit_share_debit from public.settings where id) = 'dividends' then 'dividends' else 'profit_share' end);
  -- an adjustment is dated with the entry that caused it, never before completion
  v_date := greatest((select completed_at::date from public.projects where id = d.project_id), p_date);
  insert into public.transactions (type, date, number, project_id, distribution_id, adjusts_id, memo)
  values ('distribution', v_date, public.next_doc_number('distribution', v_date), d.project_id, p_dist,
    (select journal_transaction_id from public.distributions where id = d.adjusts_distribution_id),
    case d.reason when 'completion' then 'Profit split on completion' when 'bad_debt' then 'Profit split adjusted for a bad debt'
      when 'late_entry' then 'Profit split adjusted for a late entry' else 'Profit split adjustment' end)
  returning id into v_txn;
  for l in select * from public.distribution_lines where distribution_id = p_dist and amount <> 0 order by component, amount desc loop
    n := n + 1;
    insert into public.transaction_lines (transaction_id, line_no, account_id, debit, credit, contact_id, project_id, component)
    values (v_txn, n, case when l.component = 'financing_return' then public.acct('finance_cost') else share_acct end,
      greatest(l.amount, 0), greatest(-l.amount, 0), l.contact_id, d.project_id, l.component);
    n := n + 1;
    insert into public.transaction_lines (transaction_id, line_no, account_id, debit, credit, contact_id, project_id, component)
    values (v_txn, n, public.sub_account(case when l.component = 'financing_return' then 'financing_return_payable' else 'profit_share_payable' end, l.contact_id),
      greatest(-l.amount, 0), greatest(l.amount, 0), l.contact_id, d.project_id, l.component);
  end loop;
  perform public.post_transaction(v_txn);
  update public.distributions set journal_transaction_id = v_txn where id = p_dist;
  return v_txn;
end $$;

/** Complete a project: work out its profit and post the split (after the preview is confirmed). */
create or replace function public.complete_project(p_project uuid, p_date date) returns uuid language plpgsql as $$
declare p public.projects; v_dist uuid; v_profit numeric;
begin
  select * into p from public.projects where id = p_project for update;
  if p.completed_at is not null then raise exception 'This project is already completed'; end if;
  update public.projects set completed_at = p_date, status = 'completed' where id = p_project;
  v_profit := public.project_profit(p_project);
  insert into public.distributions (project_id, scheme_id, profit_amount, reason)
  values (p_project, coalesce(p.scheme_id, public.scheme_on(coalesce(p.start_date, p_date))), v_profit, 'completion') returning id into v_dist;
  insert into public.distribution_lines (distribution_id, contact_id, component, amount)
  select v_dist, s.contact_id, s.component, s.amount from public.split_profit(p_project, v_profit) s;
  perform public._post_distribution(v_dist, p_date);
  return v_dist;
end $$;

/**
 * Recalculate a completed project's split on its current profit and post the
 * difference as an adjustment (§6: bad debts and late entries). Never edits
 * what was posted before.
 */
create or replace function public.adjust_distribution(p_project uuid, p_reason text, p_date date default null) returns uuid language plpgsql as $$
declare base public.distributions; v_profit numeric; v_dist uuid;
begin
  select * into base from public.distributions where project_id = p_project and reason = 'completion';
  if not found then return null; end if;
  v_profit := public.project_profit(p_project);
  create temp table if not exists _split_delta (contact_id uuid, component text, amount numeric) on commit drop;
  delete from _split_delta;
  insert into _split_delta
  select coalesce(t.contact_id, p.contact_id), coalesce(t.component, p.component), coalesce(t.amount, 0) - coalesce(p.amount, 0)
  from (select contact_id, component, amount from public.split_profit(p_project, v_profit)) t
  full join (select dl.contact_id, dl.component, sum(dl.amount) amount from public.distribution_lines dl
             join public.distributions d on d.id = dl.distribution_id where d.project_id = p_project group by 1, 2) p
    on p.contact_id = t.contact_id and p.component = t.component;
  if not exists (select 1 from _split_delta where amount <> 0) then return null; end if;
  insert into public.distributions (project_id, scheme_id, profit_amount, reason, adjusts_distribution_id)
  values (p_project, base.scheme_id, v_profit, p_reason, base.id) returning id into v_dist;
  insert into public.distribution_lines (distribution_id, contact_id, component, amount)
  select v_dist, contact_id, component, amount from _split_delta where amount <> 0;
  perform public._post_distribution(v_dist, coalesce(p_date, public.today_mv()));
  if p_reason = 'late_entry' then
    update public.projects set review_flag = 'Revenue or costs were posted after completion; the profit split was adjusted' where id = p_project;
  end if;
  return v_dist;
end $$;

/** After any posting that moves a completed project's profit, adjust its split. */
create or replace function public._after_post(p_id uuid, p_old_projects uuid[]) returns void language plpgsql as $$
declare t public.transactions; pr uuid;
begin
  select * into t from public.transactions where id = p_id;
  if t.type not in ('invoice', 'credit_note', 'sales_receipt', 'bill', 'vendor_credit', 'expense', 'journal', 'payroll_run', 'bad_debt') then return; end if;
  for pr in select distinct x from unnest(p_old_projects || coalesce(
              (select array_agg(distinct project_id) from public.journal_lines where transaction_id = p_id and project_id is not null), '{}')) x
            where exists (select 1 from public.distributions d where d.project_id = x and d.reason = 'completion') loop
    perform public.adjust_distribution(pr, case when t.type = 'bad_debt' then 'bad_debt' else 'late_entry' end, t.date);
  end loop;
end $$;

/**
 * Payout gate (§6): nothing is paid out on a project — principal, return or
 * share — until it is completed and the client owes exactly nothing; and never
 * more than is owed to that person for that component.
 */
create or replace function public._payout_gate(t public.transactions) returns void language plpgsql as $$
declare r record; cb numeric; owed numeric; v_acct uuid;
begin
  for r in select coalesce(l.project_id, t.project_id) pid, coalesce(l.contact_id, t.contact_id) cid, l.component, sum(l.amount) amt
           from public.transaction_lines l where l.transaction_id = t.id group by 1, 2, 3 loop
    if not exists (select 1 from public.projects where id = r.pid and completed_at is not null) then
      raise exception 'Payouts start once the project is completed' using errcode = 'P0001';
    end if;
    cb := public.client_balance(r.pid);
    if abs(cb) >= 0.005 then
      raise exception 'Payout blocked: the client still owes MVR % on %', to_char(cb, 'FM999,999,999,990.00'),
        (select code from public.projects where id = r.pid) using errcode = 'P0001';
    end if;
    v_acct := case r.component
      when 'principal' then public.sub_account(case when exists (select 1 from public.contacts where id = r.cid and 'partner' = any (kinds))
        then 'capital_pool_loans' else 'project_loans' end, r.cid)
      when 'financing_return' then public.sub_account('financing_return_payable', r.cid)
      else public.sub_account('profit_share_payable', r.cid) end;
    select coalesce(sum(home_credit - home_debit), 0) into owed from public.journal_lines
      where account_id = v_acct and project_id = r.pid and transaction_id <> t.id;
    if r.amt > owed + 0.005 then
      raise exception 'That is more than the MVR % owed to % for this', to_char(owed, 'FM999,999,999,990.00'),
        (select name from public.contacts where id = r.cid) using errcode = 'P0001';
    end if;
  end loop;
end $$;

/** Whether a project can pay out now, and why not (for the Payouts screen). */
create or replace function public.payout_status(p_project uuid, out blocked boolean, out reason text, out client_owes numeric) language plpgsql stable as $$
begin
  client_owes := public.client_balance(p_project);
  if not exists (select 1 from public.projects where id = p_project and completed_at is not null) then
    blocked := true; reason := 'The project is not completed yet';
  elsif abs(client_owes) >= 0.005 then
    blocked := true; reason := 'The client still owes MVR ' || to_char(client_owes, 'FM999,999,999,990.00');
  else
    blocked := false; reason := null;
  end if;
end $$;

/** Each person's statement: principal, financing return and profit share per project, kept apart (§5). */
create or replace view public.partner_statement_v as
select j.contact_id, j.project_id,
  case par.subtype when 'financing_return_payable' then 'financing_return' when 'profit_share_payable' then 'profit_share' else 'principal' end as component,
  sum(j.home_credit) as accrued,
  sum(j.home_debit) as paid,
  sum(j.home_credit - j.home_debit) as outstanding
from public.journal_lines j
join public.accounts a on a.id = j.account_id
join public.accounts par on par.id = a.parent_id
where par.subtype in ('project_loans', 'capital_pool_loans', 'financing_return_payable', 'profit_share_payable')
group by j.contact_id, j.project_id, par.subtype;

create trigger profit_schemes_audit after insert or update or delete on public.profit_schemes for each row execute function public.log_change();
create trigger scheme_allocations_audit after insert or update or delete on public.scheme_allocations for each row execute function public.log_change();
create trigger distributions_audit after insert or update or delete on public.distributions for each row execute function public.log_change();
create trigger distribution_lines_audit after insert or update or delete on public.distribution_lines for each row execute function public.log_change();
