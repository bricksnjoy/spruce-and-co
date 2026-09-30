import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/** Expenses: vendors = shops, bill approval, paying bills, credits, purchase orders (migration 021). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const saveAs = (uid: string, p: object) => as(uid, () => one<{ id: string }>(db, `select rpc_save_transaction($1::jsonb) id`, [JSON.stringify(p)])).then((r) => r.id);
const save = (p: object) => saveAs(ADMIN, p);
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;
const status = (id: string) => as(ADMIN, () => one<{ status: string }>(db, `select status from expenses_list_v where id = $1`, [id])).then((r) => r.status);

let vendor: string, mat: string, bank: string, project: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Manager', 'manager')`, [ADMIN, MANAGER]);
  vendor = (await one<{ id: string }>(db, `insert into contacts (kinds, name, tin, gst_registered, vendor_kind) values ('{vendor}', 'Timber Ltd', '1000001GST501', true, 'supplier') returning id`)).id;
  mat = await acct("5000"); bank = await acct("1010");
  project = (await one<{ id: string }>(db, `insert into projects (code, name) values ('P-1', 'Clinic') returning id`)).id;
});

describe("vendors and shops are one list", () => {
  it("a new vendor appears in the old vendors table, and a shop added there becomes a vendor", async () => {
    const v = await one<{ name: string; kind: string; tin: string }>(db,
      `select v.name, v.kind::text, v.tin from vendors v join contacts c on c.legacy ->> 'vendor_id' = v.id::text where c.id = $1`, [vendor]);
    expect(v).toEqual({ name: "Timber Ltd", kind: "supplier", tin: "1000001GST501" });
    const shop = (await one<{ id: string }>(db, `insert into vendors (name, kind, phone) values ('Hardware Shop', 'supplier', '333') returning id`)).id;
    expect(await q(db, `select name, phone, kinds from contacts where legacy ->> 'vendor_id' = $1`, [shop])).toEqual([{ name: "Hardware Shop", phone: "333", kinds: ["vendor"] }]);
  });
});

describe("bill approval", () => {
  it("a bill over the limit posts only once an admin approves it, and only up to the approved amount", async () => {
    await db.query(`update settings set approval_limit_bill = 10000`);
    const bill = { type: "bill", date: "2026-03-01", contact_id: vendor, lines: [{ account_id: mat, amount: "15000.00" }] };
    await expect(saveAs(MANAGER, bill)).rejects.toThrow(/approval limit/);
    const draft = await saveAs(MANAGER, { ...bill, is_draft: true });
    await as(MANAGER, () => db.query(`select rpc_request_approval($1)`, [draft]));
    expect(await status(draft)).toBe("awaiting_approval");
    await expect(as(MANAGER, () => db.query(`select rpc_approve_bill($1)`, [draft]))).rejects.toThrow(/Only an admin/);
    await as(ADMIN, () => db.query(`select rpc_approve_bill($1)`, [draft]));
    expect(await status(draft)).toBe("open");
    // raising it above what was approved is refused; lowering it is fine
    await expect(saveAs(MANAGER, { ...bill, id: draft, lines: [{ account_id: mat, amount: "16000.00" }] })).rejects.toThrow(/approval limit/);
    await saveAs(MANAGER, { ...bill, id: draft, lines: [{ account_id: mat, amount: "14000.00" }] });
    // below the limit needs no approval
    await saveAs(MANAGER, { ...bill, lines: [{ account_id: mat, amount: "900.00" }] });
    await assertHealthy(db);
  });
});

describe("paying bills", () => {
  it("pays several bills in one go, one payment per vendor, all or nothing", async () => {
    const v2 = (await one<{ id: string }>(db, `insert into contacts (kinds, name) values ('{vendor}', 'Cement Co') returning id`)).id;
    const b1 = await save({ type: "bill", date: "2026-03-01", due_date: "2026-03-10", contact_id: vendor, lines: [{ account_id: mat, amount: "1000.00" }] });
    const b2 = await save({ type: "bill", date: "2026-03-02", contact_id: vendor, lines: [{ account_id: mat, amount: "500.00" }] });
    const b3 = await save({ type: "bill", date: "2026-03-03", contact_id: v2, lines: [{ account_id: mat, amount: "300.00" }] });
    const ids = await as(ADMIN, () => one<{ ids: string[] }>(db, `select rpc_pay_bills($1, '2026-03-20', $2::jsonb, 'TT-1') ids`,
      [bank, JSON.stringify([{ bill: b1, amount: "1000.00" }, { bill: b2, amount: "200.00" }, { bill: b3, amount: "300.00" }])]));
    expect(ids.ids.length).toBe(2);
    expect([await status(b1), await status(b2), await status(b3)]).toEqual(["paid", "partial", "paid"]);
    expect((await as(ADMIN, () => one<{ v: string }>(db, `select bills_paid_since('2026-03-01')::text v`))).v).toBe("1500.00");
    // overpaying any one bill stops the whole run
    await expect(as(ADMIN, () => db.query(`select rpc_pay_bills($1, '2026-03-21', $2::jsonb)`, [bank, JSON.stringify([{ bill: b2, amount: "301.00" }])])))
      .rejects.toThrow(/More is applied/);
    await assertHealthy(db);
  });

  it("applies a vendor credit to a bill later", async () => {
    const b = await save({ type: "bill", date: "2026-03-01", contact_id: vendor, lines: [{ account_id: mat, amount: "1000.00" }] });
    const vc = await save({ type: "vendor_credit", date: "2026-03-05", contact_id: vendor, lines: [{ account_id: mat, amount: "250.00" }] });
    await as(ADMIN, () => db.query(`select rpc_apply_credit($1, $2, 250)`, [vc, b]));
    expect((await as(ADMIN, () => one<{ balance: string }>(db, `select balance::text from expenses_list_v where id = $1`, [b]))).balance).toBe("750.00");
    await expect(as(ADMIN, () => db.query(`select rpc_apply_credit($1, $2, 1)`, [vc, b]))).rejects.toThrow(/More is applied from/);
  });
});

describe("purchase orders", () => {
  it("count as committed cost until billed, and become a draft bill with the same lines", async () => {
    const po = await save({ type: "purchase_order", date: "2026-03-01", contact_id: vendor, project_id: project,
      lines: [{ account_id: mat, amount: "4000.00", description: "Timber", project_id: project }] });
    expect(await as(ADMIN, () => q(db, `select budget_category, committed::text from committed_cost_v where project_id = $1`, [project])))
      .toEqual([{ budget_category: "materials", committed: "4000.00" }]);
    expect(await status(po)).toBe("open");
    const bill = (await as(ADMIN, () => one<{ id: string }>(db, `select rpc_bill_from_po($1, '2026-03-10') id`, [po]))).id;
    expect(await status(po)).toBe("closed");
    expect(await as(ADMIN, () => q(db, `select * from committed_cost_v where project_id = $1`, [project]))).toEqual([]);
    const b = await one<{ is_draft: boolean; purchase_order_id: string; total: string }>(db, `select is_draft, purchase_order_id, doc_total(id)::text total from transactions where id = $1`, [bill]);
    expect(b).toEqual({ is_draft: true, purchase_order_id: po, total: "4000.00" });
    await expect(as(ADMIN, () => db.query(`select rpc_bill_from_po($1, '2026-03-11')`, [po]))).rejects.toThrow(/already billed/);
  });
});
