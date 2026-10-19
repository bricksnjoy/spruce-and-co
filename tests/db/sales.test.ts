import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/** Sales: stage invoices, deposits, voids and the sales list (migration 019). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const id = (sql: string, p: unknown[] = []) => as(ADMIN, () => one<{ id: string }>(db, sql, p)).then((r) => r.id);
const save = (p: object) => id(`select rpc_save_transaction($1::jsonb) id`, [JSON.stringify(p)]);
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;

let customer: string, project: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [ADMIN]);
  await db.query(`update settings set gst_registered = true`);
  customer = (await one<{ id: string }>(db, `insert into contacts (kinds, name, terms_days) values ('{customer}', 'Ministry', 14) returning id`)).id;
  project = (await one<{ id: string }>(db, `insert into projects (code, name, customer_id, contract_value) values ('P-1', 'Clinic', $1, 100000) returning id`, [customer])).id;
  await db.query(`insert into variations (project_id, title, amount, status, approved_date) values ($1, 'Extra', 20000, 'approved', '2026-01-15')`, [project]);
});

describe("billing stages become invoices", () => {
  it("invoices the stage's share of the revised contract, with GST and the customer's terms", async () => {
    const st = (await one<{ id: string }>(db, `insert into billing_stages (project_id, name, basis, value) values ($1, 'Mobilisation', 'percent', 30) returning id`, [project])).id;
    const inv = await id(`select rpc_invoice_stage($1, '2026-02-01') id`, [st]);
    const t = await one<{ number: string; due: string; total: string; project: string }>(db,
      `select number, due_date::text due, doc_total(id)::text total, project_id::text project from transactions where id = $1`, [inv]);
    expect(t).toEqual({ number: "SC-INV/26/001", due: "2026-02-15", total: "38880.00", project });   // 30% of 120,000 + 8% GST
    expect((await one<{ invoice_id: string }>(db, `select invoice_id from billing_stages where id = $1`, [st])).invoice_id).toBe(inv);
    await expect(id(`select rpc_invoice_stage($1, '2026-02-02') id`, [st])).rejects.toThrow(/already invoiced/);

    // voiding the invoice frees the stage to be invoiced again
    await as(ADMIN, () => db.query(`select rpc_void($1, 'wrong date')`, [inv]));
    expect((await one<{ invoice_id: string | null }>(db, `select invoice_id from billing_stages where id = $1`, [st])).invoice_id).toBeNull();
    await id(`select rpc_invoice_stage($1, '2026-02-03') id`, [st]);
    await assertHealthy(db);
  });

  it("refuses a project with no customer", async () => {
    const p2 = (await one<{ id: string }>(db, `insert into projects (code, name, contract_value) values ('P-2', 'No client', 5000) returning id`)).id;
    const st = (await one<{ id: string }>(db, `insert into billing_stages (project_id, name, basis, value) values ($1, 'All', 'amount', 5000) returning id`, [p2])).id;
    await expect(id(`select rpc_invoice_stage($1, '2026-02-01') id`, [st])).rejects.toThrow(/customer/);
  });
});

describe("deposits", () => {
  it("bank exactly the receipts chosen, once", async () => {
    const bank = await acct("1010");
    const inv = await save({ type: "invoice", date: "2026-03-01", contact_id: customer, lines: [{ amount: "1000.00" }] });
    const pay = await save({ type: "customer_payment", date: "2026-03-05", contact_id: customer, total_amount: "600.00", applications: [{ to: inv, amount: "600.00" }] });
    const sr = await save({ type: "sales_receipt", date: "2026-03-06", contact_id: customer, lines: [{ amount: "100.00" }] });
    const dep = await id(`select rpc_make_deposit($1, '2026-03-07', $2::uuid[]) id`, [bank, [pay, sr]]);
    expect((await one<{ t: string }>(db, `select total_amount::text t from transactions where id = $1`, [dep])).t).toBe("700.00");
    const und = await one<{ b: string }>(db, `select coalesce(sum(home_debit - home_credit), 0)::text b from journal_lines where account_id = $1`, [await acct("1040")]);
    expect(und.b).toBe("0.00");
    await expect(id(`select rpc_make_deposit($1, '2026-03-08', $2::uuid[]) id`, [bank, [pay]])).rejects.toThrow(/already deposited/);

    // a receipt in a deposit cannot be voided; void the deposit first, which frees it
    await expect(as(ADMIN, () => db.query(`select rpc_void($1, 'x')`, [sr]))).rejects.toThrow(/void the deposit first/);
    await as(ADMIN, () => db.query(`select rpc_void($1, 'bank error')`, [dep]));
    expect(await q(db, `select deposited_in from transactions where id in ($1, $2)`, [pay, sr])).toEqual([{ deposited_in: null }, { deposited_in: null }]);
    await assertHealthy(db);
  });

  it("refuses a receipt that went straight to the bank, or one dated after the deposit", async () => {
    const bank = await acct("1010");
    const direct = await save({ type: "sales_receipt", date: "2026-03-06", contact_id: customer, bank_account_id: bank, lines: [{ amount: "50.00" }] });
    await expect(id(`select rpc_make_deposit($1, '2026-03-07', $2::uuid[]) id`, [bank, [direct]])).rejects.toThrow(/Undeposited/);
    const later = await save({ type: "sales_receipt", date: "2026-03-09", contact_id: customer, lines: [{ amount: "50.00" }] });
    await expect(id(`select rpc_make_deposit($1, '2026-03-07', $2::uuid[]) id`, [bank, [later]])).rejects.toThrow(/before a receipt/);
  });
});

describe("the sales list and money bar", () => {
  it("lists documents with customer, project and status, and totals what was paid", async () => {
    const inv = await save({ type: "invoice", date: "2026-03-01", due_date: "2026-03-10", contact_id: customer, project_id: project, lines: [{ amount: "1000.00", project_id: project }] });
    await save({ type: "customer_payment", date: "2026-03-20", contact_id: customer, total_amount: "400.00", applications: [{ to: inv, amount: "400.00" }] });
    const rows = await as(ADMIN, () => q<{ type: string; customer_name: string; project_code: string | null; status: string; balance: string }>(db,
      `select type::text, customer_name, project_code, status, balance::text from sales_list_v order by date`));
    expect(rows[0]).toEqual({ type: "invoice", customer_name: "Ministry", project_code: "P-1", status: "overdue", balance: "600.00" });
    expect(rows[1]).toMatchObject({ type: "customer_payment", status: "posted" });
    expect((await as(ADMIN, () => one<{ v: string }>(db, `select sales_paid_since('2026-03-01')::text v`))).v).toBe("400.00");
    expect((await as(ADMIN, () => one<{ v: string }>(db, `select sales_paid_since('2026-04-01')::text v`))).v).toBe("0");
  });
});

describe("client advances (B2)", () => {
  it("are held for the customer and can only be used up to what was paid", async () => {
    const bank = await acct("1010");
    await save({ type: "customer_advance", date: "2026-01-05", contact_id: customer, project_id: project, bank_account_id: bank, total_amount: "5000.00" });
    expect((await as(ADMIN, () => one<{ v: string }>(db, `select customer_advance_balance($1)::text v`, [customer]))).v).toBe("5000.00");
    const inv = await save({ type: "invoice", date: "2026-02-01", contact_id: customer, lines: [{ amount: "8000.00" }] });
    await save({ type: "advance_application", date: "2026-02-02", contact_id: customer, total_amount: "3000.00", applications: [{ to: inv, amount: "3000.00" }] });
    expect((await as(ADMIN, () => one<{ v: string }>(db, `select customer_advance_balance($1)::text v`, [customer]))).v).toBe("2000.00");
    await expect(save({ type: "advance_application", date: "2026-02-03", contact_id: customer, total_amount: "2500.00", applications: [{ to: inv, amount: "2500.00" }] }))
      .rejects.toThrow(/more advance than Ministry has paid/);
    const bal = await as(ADMIN, () => one<{ balance: string }>(db, `select balance::text from sales_list_v where id = $1`, [inv]));
    expect(bal.balance).toBe("5000.00");
    await assertHealthy(db);
  });
});
