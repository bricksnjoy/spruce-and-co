import type { PGlite } from "@electric-sql/pglite";
import { one, q, type Db } from "./harness";

export interface LineSpec {
  account?: string;       // account code
  description?: string;
  qty?: number;
  rate?: number;
  amount?: number;
  tax?: "STD" | "ZERO" | "EXEMPT" | "OOS";
  taxAmount?: number;     // a supplier's own GST figure (no tax code)
  claimable?: boolean;
  project?: string;       // project id
  employee?: string;
  contact?: string;
  component?: "principal" | "financing_return" | "profit_share";
  debit?: number;
  credit?: number;
}

export interface DocSpec {
  type: string;
  date: string;
  number?: string;
  dueDate?: string;
  contact?: string;
  project?: string;
  employee?: string;
  bank?: string;          // account code
  total?: number;
  fx?: number;
  currency?: string;
  memo?: string;
  supplierTin?: string;
  taxInvoiceNo?: string;
  taxInvoiceDate?: string;
  customsRef?: string;
  draft?: boolean;
  taxPeriod?: string;
  lines?: LineSpec[];
  apply?: { to: string; amount: number }[];
}

export const accountId = async (db: Db, code: string) =>
  (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;

/** Save a document with its lines and applications and post it, all in one database transaction (as the RPCs will). */
export async function doc(db: PGlite, d: DocSpec): Promise<string> {
  return db.transaction(async (tx) => {
    const bank = d.bank ? await accountId(tx, d.bank) : null;
    const { id } = await one<{ id: string }>(tx,
      `insert into transactions (type, date, number, due_date, contact_id, project_id, employee_id, bank_account_id, total_amount,
         fx_rate, currency, memo, supplier_tin, tax_invoice_no, tax_invoice_date, customs_ref, is_draft, tax_period_id)
       values ($1::txn_type, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::numeric, 1), coalesce($11, 'MVR'), $12, $13, $14, $15, $16, coalesce($17, false), $18)
       returning id`,
      [d.type, d.date, d.number ?? null, d.dueDate ?? null, d.contact ?? null, d.project ?? null, d.employee ?? null, bank,
        d.total ?? null, d.fx ?? null, d.currency ?? null, d.memo ?? null, d.supplierTin ?? null, d.taxInvoiceNo ?? null,
        d.taxInvoiceDate ?? null, d.customsRef ?? null, d.draft ?? null, d.taxPeriod ?? null]);
    let i = 0;
    for (const l of d.lines ?? []) {
      i++;
      await tx.query(
        `insert into transaction_lines (transaction_id, line_no, account_id, description, qty, rate, amount, tax_code_id, tax_amount,
           gst_claimable, project_id, employee_id, contact_id, component, debit, credit)
         values ($1, $2, (select id from accounts where code = $3), $4, $5, $6, coalesce($7, 0),
           (select id from tax_codes where code = $8), coalesce($9, 0), coalesce($10, false), $11, $12, $13, $14, coalesce($15, 0), coalesce($16, 0))`,
        [id, i, l.account ?? null, l.description ?? null, l.qty ?? null, l.rate ?? null, l.amount ?? null, l.tax ?? null,
          l.taxAmount ?? null, l.claimable ?? null, l.project ?? null, l.employee ?? null, l.contact ?? null, l.component ?? null,
          l.debit ?? null, l.credit ?? null]);
    }
    for (const a of d.apply ?? []) {
      await tx.query(`insert into applications (from_transaction_id, to_transaction_id, amount) values ($1, $2, $3)`, [id, a.to, a.amount]);
    }
    await tx.query(`select post_transaction($1)`, [id]);
    return id;
  });
}

/** A document's journal as [account code, debit, credit] rows, sorted, for exact comparison. */
export async function journal(db: Db, txnId: string) {
  const rows = await q<{ code: string; dr: string; cr: string }>(db,
    `select a.code, sum(j.home_debit)::text dr, sum(j.home_credit)::text cr
     from journal_lines j join accounts a on a.id = j.account_id where j.transaction_id = $1
     group by a.code order by a.code`, [txnId]);
  return rows.map((r) => [r.code, Number(r.dr), Number(r.cr)] as const);
}

/** An account's balance (debit − credit), optionally for one project or contact. */
export async function balance(db: Db, code: string, opts: { project?: string; contact?: string; employee?: string } = {}) {
  const r = await one<{ b: string }>(db,
    `select coalesce(sum(j.home_debit - j.home_credit), 0)::text b from journal_lines j
     join accounts a on a.id = j.account_id
     where (a.code = $1 or a.parent_id = (select id from accounts where code = $1))
       and ($2::uuid is null or j.project_id = $2) and ($3::uuid is null or j.contact_id = $3) and ($4::uuid is null or j.employee_id = $4)`,
    [code, opts.project ?? null, opts.contact ?? null, opts.employee ?? null]);
  return Number(r.b);
}

export async function contact(db: Db, name: string, kinds: string[], extra: { tin?: string; gst?: boolean } = {}) {
  return (await one<{ id: string }>(db,
    `insert into contacts (name, kinds, tin, gst_registered) values ($1, $2, $3, coalesce($4, false)) returning id`,
    [name, kinds, extra.tin ?? null, extra.gst ?? null])).id;
}

export async function contactId(db: Db, name: string) {
  return (await one<{ id: string }>(db, `select id from contacts where name = $1`, [name])).id;
}

export async function project(db: Db, code: string, customer: string | null, contractValue: number, extra: { start?: string } = {}) {
  const { id } = await one<{ id: string }>(db,
    `insert into projects (code, name, contract_value, status, start_date)
     values ($1, $1, $2, 'in_progress', coalesce($3::date, '2026-01-01')) returning id`,
    [code, contractValue, extra.start ?? null]);
  // projects.customer_id arrives with migration 006
  const hasCustomer = await one<{ ok: boolean }>(db,
    `select exists (select 1 from information_schema.columns where table_name = 'projects' and column_name = 'customer_id') ok`);
  if (customer && hasCustomer.ok) await db.query(`update projects set customer_id = $1 where id = $2`, [customer, id]);
  return id;
}

export async function status(db: Db, id: string) {
  return (await one<{ s: string }>(db, `select document_status($1) s`, [id])).s;
}
