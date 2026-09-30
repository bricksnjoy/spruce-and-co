import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/** The project screens' view and the rules around a project's parts (migration 018). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;
const save = (p: object) => as(ADMIN, () => one<{ id: string }>(db, `select rpc_save_transaction($1::jsonb) id`, [JSON.stringify(p)])).then((r) => r.id);

beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [ADMIN]);
});

describe("the project list", () => {
  it("shows value, billing, cost, forecast and stage from the ledger", async () => {
    const c = (await one<{ id: string }>(db, `insert into contacts (kinds, name) values ('{customer}', 'Ministry') returning id`)).id;
    const p = (await one<{ id: string }>(db, `insert into projects (code, name, customer_id, contract_value) values ('P-1', 'Clinic', $1, 100000) returning id`, [c])).id;
    await db.query(`insert into variations (project_id, title, amount, status, approved_date) values ($1, 'Extra room', 20000, 'approved', '2026-02-01')`, [p]);
    await db.query(`insert into budget_lines (project_id, description, budget_amount, budget_category) values ($1, 'Materials', 60000, 'materials')`, [p]);
    await save({ type: "invoice", date: "2026-03-01", contact_id: c, project_id: p, lines: [{ amount: "30000.00", project_id: p }] });
    const ven = (await one<{ id: string }>(db, `insert into contacts (kinds, name) values ('{vendor}', 'Timber') returning id`)).id;
    await save({ type: "bill", date: "2026-03-02", contact_id: ven, project_id: p, lines: [{ account_id: await acct("5000"), amount: "15000.00", project_id: p }] });

    const row = await as(ADMIN, () => one<Record<string, string>>(db,
      `select revised::text, billed::text, cost_to_date::text, forecast_final_cost::text, forecast_profit::text, customer_name, stage from project_list_v where id = $1`, [p]));
    expect(row).toEqual({ revised: "120000.00", billed: "30000.00", cost_to_date: "15000.00", forecast_final_cost: "60000.00",
      forecast_profit: "60000.00", customer_name: "Ministry", stage: "active" });
    await assertHealthy(db);
  });

  it("numbers variations and gives them a reference", async () => {
    const p = (await one<{ id: string }>(db, `insert into projects (code, name) values ('P-2', 'Villa') returning id`)).id;
    await db.query(`insert into variations (project_id, title, cost_impact) values ($1, 'A', 100), ($1, 'B', 50)`, [p]);
    expect(await q(db, `select number, ref, amount::text from variations where project_id = $1 order by number`, [p]))
      .toEqual([{ number: 1, ref: "VO-01", amount: "100.00" }, { number: 2, ref: "VO-02", amount: "50.00" }]);
  });
});

describe("a project's parts follow its book", () => {
  it("a Test user cannot see or change a Live project's variations, budget or billing plan", async () => {
    const p = (await one<{ id: string }>(db, `insert into projects (code, name) values ('P-3', 'Real') returning id`)).id;
    await db.query(`insert into variations (project_id, title, cost_impact) values ($1, 'Real VO', 10)`, [p]);
    await db.query(`insert into budget_lines (project_id, description, budget_amount) values ($1, 'Real budget', 10)`, [p]);
    await db.query(`insert into billing_stages (project_id, name, value) values ($1, 'Deposit', 20)`, [p]);
    await as(ADMIN, () => db.query(`select rpc_set_book('sandbox')`));
    for (const t of ["variations", "budget_lines", "billing_stages"]) {
      expect(await as(ADMIN, () => q(db, `select * from ${t}`))).toEqual([]);
    }
    await expect(as(ADMIN, () => db.query(`insert into variations (project_id, title) values ($1, 'sneaky')`, [p]))).rejects.toThrow(/row-level security/);
    await as(ADMIN, () => db.query(`select rpc_set_book('live')`));
    expect((await as(ADMIN, () => q(db, `select * from variations`))).length).toBe(1);
  });
});
