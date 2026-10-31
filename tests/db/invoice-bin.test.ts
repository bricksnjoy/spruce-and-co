import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/** Deleting an invoice, and restoring it within 30 days (migration 047). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const id = (sql: string, p: unknown[] = []) => as(ADMIN, () => one<{ id: string }>(db, sql, p)).then((r) => r.id);
const save = (p: object) => id(`select rpc_save_transaction($1::jsonb) id`, [JSON.stringify(p)]);
const run = (sql: string, params: unknown[] = []) => as(ADMIN, () => db.query(sql, params));
const status = (doc: string) => as(ADMIN, () => one<{ status: string; balance: string }>(db, `select status, balance::text from sales_list_v where id = $1`, [doc]));
const voided = (doc: string) => one<{ v: boolean }>(db, `select voided_at is not null v from transactions where id = $1`, [doc]).then((r) => r.v);
const stageInvoice = (st: string) => one<{ invoice_id: string | null }>(db, `select invoice_id from billing_stages where id = $1`, [st]).then((r) => r.invoice_id);

let customer: string, project: string, bank: string, stage: string, inv: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [ADMIN]);
  customer = (await one<{ id: string }>(db, `insert into contacts (kinds, name) values ('{customer}', 'Ministry') returning id`)).id;
  project = (await one<{ id: string }>(db, `insert into projects (code, name, customer_id, contract_value) values ('P-1', 'Clinic', $1, 100000) returning id`, [customer])).id;
  bank = (await one<{ id: string }>(db, `select id from accounts where code = '1010'`)).id;
  stage = (await one<{ id: string }>(db, `insert into billing_stages (project_id, name, basis, value) values ($1, 'Advance', 'amount', 20000) returning id`, [project])).id;
  inv = await id(`select rpc_invoice_stage($1, '2026-03-01') id`, [stage]);
});
const receive = (amount: string, apply = [{ to: inv, amount }]) =>
  save({ type: "customer_payment", date: "2026-03-05", contact_id: customer, bank_account_id: bank, total_amount: amount, applications: apply });

describe("deleting an invoice", () => {
  it("frees its billing stage and keeps the payment as the customer's credit; restoring puts it all back", async () => {
    const p = await receive("21600.00");   // the stage with 8% GST
    await run(`select rpc_delete_sales_doc($1, false)`, [inv]);
    expect(await voided(inv)).toBe(true);
    expect(await voided(p)).toBe(false);   // the money was received: it stays, unapplied
    expect(await q(db, `select count(*)::int n from applications where from_transaction_id = $1`, [p])).toEqual([{ n: 0 }]);
    expect(await stageInvoice(stage)).toBeNull();
    await assertHealthy(db);

    await run(`select rpc_restore_bill($1)`, [inv]);
    expect(await status(inv)).toMatchObject({ balance: "0.00" });
    expect(await stageInvoice(stage)).toBe(inv);
    expect(await q(db, `select count(*)::int n from bill_bin`)).toEqual([{ n: 0 }]);
    await assertHealthy(db);
  });

  it("deletes the payments with it when asked, and they come back on restore", async () => {
    const p = await receive("5000.00");
    await run(`select rpc_delete_sales_doc($1, true)`, [inv]);
    expect(await voided(p)).toBe(true);
    await assertHealthy(db);
    await run(`select rpc_restore_bill($1)`, [inv]);
    expect(await voided(p)).toBe(false);
    expect(await status(inv)).toMatchObject({ balance: "16600.00" });
    await assertHealthy(db);
  });

  it("keeps a payment that also paid another invoice, and will not restore over a stage invoiced again", async () => {
    const other = await save({ type: "invoice", date: "2026-03-02", contact_id: customer, lines: [{ description: "Extra", amount: "1000.00" }] });
    await receive("6000.00", [{ to: inv, amount: "5000.00" }, { to: other, amount: "1000.00" }]);
    await expect(run(`select rpc_delete_sales_doc($1, true)`, [inv])).rejects.toThrow(/paid together with other invoices/);
    await run(`select rpc_delete_sales_doc($1, false)`, [inv]);
    expect(await status(other)).toMatchObject({ balance: "0.00" });

    await id(`select rpc_invoice_stage($1, '2026-03-10') id`, [stage]);
    await expect(run(`select rpc_restore_bill($1)`, [inv])).rejects.toThrow(/invoiced again/);
    await assertHealthy(db);
  });
});
