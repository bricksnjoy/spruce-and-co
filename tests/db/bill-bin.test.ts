import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/** Deleting a bill, and restoring it within 30 days (migration 037). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const VIEWER = "00000000-0000-0000-0000-00000000000c";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const save = (p: object) => as(ADMIN, () => one<{ id: string }>(db, `select rpc_save_transaction($1::jsonb) id`, [JSON.stringify(p)])).then((r) => r.id);
const run = (sql: string, params: unknown[] = []) => as(ADMIN, () => db.query(sql, params));
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;
const doc = (id: string) => as(ADMIN, () => one<{ status: string; balance: string }>(db, `select status, balance::text from expenses_list_v where id = $1`, [id]));
const pay = (bill: string, amount: string) => as(ADMIN, () => one<{ ids: string[] }>(db, `select rpc_pay_bills($1, '2026-03-20', $2::jsonb) ids`,
  [bank, JSON.stringify([{ bill, amount }])])).then((r) => r.ids[0]);
const bankTotal = () => as(ADMIN, () => one<{ v: string }>(db, `select coalesce(sum(home_debit - home_credit), 0)::numeric(18,2)::text v from journal_lines where account_id = $1`, [bank])).then((r) => r.v);

let vendor: string, mat: string, bank: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Viewer', 'viewer')`, [ADMIN, VIEWER]);
  vendor = (await one<{ id: string }>(db, `insert into contacts (kinds, name) values ('{vendor}', 'Timber Ltd') returning id`)).id;
  mat = await acct("5000"); bank = await acct("1010");
});

describe("deleting a bill", () => {
  it("voids a paid bill with its payment, and restoring puts both back as they were", async () => {
    const b = await save({ type: "bill", date: "2026-03-01", contact_id: vendor, lines: [{ account_id: mat, amount: "1000.00" }] });
    const p = await pay(b, "1000.00");
    expect(await bankTotal()).toBe("-1000.00");

    await run(`select rpc_delete_bill($1)`, [b]);
    expect((await doc(b)).status).toBe("void");
    expect(await q(db, `select voided_at is not null v from transactions where id = $1`, [p])).toEqual([{ v: true }]);
    expect(await bankTotal()).toBe("0.00");
    expect(await as(ADMIN, () => q(db, `select payments from bill_bin where bill_id = $1`, [b]))).toEqual([{ payments: [p] }]);
    await assertHealthy(db);

    await run(`select rpc_restore_bill($1)`, [b]);
    expect(await doc(b)).toEqual({ status: "paid", balance: "0.00" });
    expect(await bankTotal()).toBe("-1000.00");
    expect(await q(db, `select count(*)::int n from bill_bin`)).toEqual([{ n: 0 }]);
    await assertHealthy(db);
  });

  it("can no longer be restored after 30 days, and stays void", async () => {
    const b = await save({ type: "bill", date: "2026-03-01", contact_id: vendor, lines: [{ account_id: mat, amount: "400.00" }] });
    await run(`select rpc_delete_bill($1)`, [b]);
    await db.query(`update bill_bin set deleted_at = now() - interval '31 days'`);
    await expect(run(`select rpc_restore_bill($1)`, [b])).rejects.toThrow(/over 30 days/);
    expect((await doc(b)).status).toBe("void");
  });

  it("refuses a bill paid together with others, until that payment is voided", async () => {
    const b1 = await save({ type: "bill", date: "2026-03-01", contact_id: vendor, lines: [{ account_id: mat, amount: "100.00" }] });
    const b2 = await save({ type: "bill", date: "2026-03-02", contact_id: vendor, lines: [{ account_id: mat, amount: "200.00" }] });
    const ids = await as(ADMIN, () => one<{ ids: string[] }>(db, `select rpc_pay_bills($1, '2026-03-20', $2::jsonb) ids`,
      [bank, JSON.stringify([{ bill: b1, amount: "100.00" }, { bill: b2, amount: "200.00" }])]));
    await expect(run(`select rpc_delete_bill($1)`, [b1])).rejects.toThrow(/paid together with other bills/);
    await run(`select rpc_void($1, 'wrong')`, [ids.ids[0]]);
    await run(`select rpc_delete_bill($1)`, [b1]);
    expect((await doc(b2)).status).toBe("open");
    await assertHealthy(db);
  });

  it("frees a vendor credit applied to it, and applies it again on restore", async () => {
    const b = await save({ type: "bill", date: "2026-03-01", contact_id: vendor, lines: [{ account_id: mat, amount: "1000.00" }] });
    const vc = await save({ type: "vendor_credit", date: "2026-03-05", contact_id: vendor, lines: [{ account_id: mat, amount: "250.00" }] });
    await run(`select rpc_apply_credit($1, $2, 250)`, [vc, b]);
    await run(`select rpc_delete_bill($1)`, [b]);
    expect((await doc(vc)).status).not.toBe("void");
    expect(await q(db, `select count(*)::int n from applications where from_transaction_id = $1`, [vc])).toEqual([{ n: 0 }]);
    await run(`select rpc_restore_bill($1)`, [b]);
    expect((await doc(b)).balance).toBe("750.00");
    await assertHealthy(db);
  });

  it("deletes an expense, and refuses viewers and other documents", async () => {
    const e = await save({ type: "expense", date: "2026-03-01", bank_account_id: bank, lines: [{ account_id: mat, amount: "50.00" }] });
    await expect(as(VIEWER, () => db.query(`select rpc_delete_bill($1)`, [e]))).rejects.toThrow();
    await run(`select rpc_delete_bill($1)`, [e]);
    expect(await bankTotal()).toBe("0.00");
    await expect(run(`select rpc_delete_bill($1)`, [e])).rejects.toThrow(/already void/);
    await run(`select rpc_restore_bill($1)`, [e]);
    expect(await bankTotal()).toBe("-50.00");
    await assertHealthy(db);
  });
});
