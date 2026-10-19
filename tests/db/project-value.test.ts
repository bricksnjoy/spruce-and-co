import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one, q, assertHealthy } from "./harness";
import { balance, contact, doc, journal, project } from "./books";

let db: PGlite;
let client: string;
let vendor: string;
let p: string;

const figures = (id: string, asOf: string | null = null) =>
  one<Record<string, string>>(db, `select * from project_figures($1, $2)`, [id, asOf]);

beforeEach(async () => {
  db = await freshDb();
  client = await contact(db, "Client", ["customer"]);
  vendor = await contact(db, "Supplier", ["vendor"]);
  p = await project(db, "PV-1", client, 1_000_000);
  await db.query(`insert into budget_lines (project_id, description, budget_amount, budget_category) values
    ($1, 'Materials', 400000, 'materials'), ($1, 'Subcontract', 200000, 'subcontractors')`, [p]);
});

afterEach(async () => { await assertHealthy(db); });

describe("project value (§4)", () => {
  it("approved variations update the revised contract value; pending and rejected do not", async () => {
    await db.query(`insert into variations (project_id, ref, title, status, cost_impact) values
      ($1, 'V1', 'Extra wall', 'approved', 50000), ($1, 'V2', 'Maybe', 'submitted', 30000), ($1, 'V3', 'No', 'rejected', 10000)`, [p]);
    const f = await figures(p);
    expect([Number(f.original), Number(f.variations), Number(f.revised)]).toEqual([1_000_000, 50000, 1_050_000]);
    const nums = await q<{ number: number }>(db, `select number from variations where project_id = $1 order by number`, [p]);
    expect(nums.map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it("% complete is cost to cost; over/under billing is billed less earned", async () => {
    await doc(db, { type: "bill", date: "2026-03-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 150000 }] });
    await doc(db, { type: "bill", date: "2026-03-02", contact: vendor, project: p, lines: [{ account: "5010", amount: 50000 }] });
    await doc(db, { type: "invoice", date: "2026-03-10", contact: client, project: p, lines: [{ account: "4000", amount: 300000, tax: "STD" }] });
    const f = await figures(p);
    // cost 200,000; forecast to complete = revised budget less actual = 250,000 + 150,000
    expect(Number(f.cost_to_date)).toBe(200000);
    expect(Number(f.forecast_to_complete)).toBe(400000);
    expect(Number(f.forecast_final_cost)).toBe(600000);
    expect(Number(f.pct_complete)).toBeCloseTo(33.3333, 4);
    expect(Number(f.earned)).toBe(333333.33);
    expect(Number(f.billed)).toBe(300000);
    expect(Number(f.over_under_billing)).toBe(-33333.33);     // under-billed
    expect(Number(f.client_balance)).toBe(324000);
    expect(Number(f.forecast_profit)).toBe(400000);
  });

  it("an edited forecast to complete replaces budget less actual", async () => {
    await doc(db, { type: "bill", date: "2026-03-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 100000 }] });
    await db.query(`update budget_lines set forecast_to_complete = 50000 where project_id = $1 and budget_category = 'materials'`, [p]);
    const f = await figures(p);
    expect(Number(f.forecast_to_complete)).toBe(50000 + 200000);
  });

  it("actual profit comes from the ledger: revenue less job costs and bad debts", async () => {
    const inv = await doc(db, { type: "invoice", date: "2026-03-10", contact: client, project: p, lines: [{ account: "4000", amount: 500000, tax: "STD" }] });
    await doc(db, { type: "bill", date: "2026-03-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 200000, taxAmount: 16000 }] });
    expect(Number((await figures(p)).actual_profit)).toBe(284000);   // GST not claimable here, so it is a cost
    await doc(db, { type: "bad_debt", date: "2026-06-30", contact: client, total: 54000, apply: [{ to: inv, amount: 54000 }] });
    expect(Number((await figures(p)).actual_profit)).toBe(230000);
  });

  it("POC: WIP posts at period end and reverses on day one of the next period", async () => {
    await db.query(`update projects set recognition_method = 'poc' where id = $1`, [p]);
    await doc(db, { type: "bill", date: "2026-03-01", contact: vendor, project: p, lines: [{ account: "5000", amount: 300000 }] });
    await doc(db, { type: "invoice", date: "2026-03-10", contact: client, project: p, lines: [{ account: "4000", amount: 200000 }] });
    const n = await db.transaction(async (tx) => (await one<{ n: number }>(tx, `select run_wip('2026-03-31') n`)).n);
    expect(n).toBe(1);
    // earned = 300,000 / 600,000 = 50% of 1,000,000 = 500,000; billed 200,000 → 300,000 unbilled
    const [wip, rev] = await q<{ id: string; date: string }>(db,
      `select id, date::text from transactions where type = 'wip_adjustment' order by date`);
    expect(wip.date).toBe("2026-03-31");
    expect(rev.date).toBe("2026-04-01");
    expect(await journal(db, wip.id)).toEqual([["1120", 300000, 0], ["4000", 0, 300000]]);
    expect(await journal(db, rev.id)).toEqual([["1120", 0, 300000], ["4000", 300000, 0]]);
    expect(await balance(db, "1120")).toBe(0);
    // WIP is not project profit, so the split is never paid on it
    expect(Number((await figures(p)).actual_profit)).toBe(-100000);
    // running it again for the same period does nothing
    expect((await one<{ n: number }>(db, `select run_wip('2026-03-31') n`)).n).toBe(0);
  });

  it("stage: active → completed → settled → closed, derived", async () => {
    const stage = async () => (await one<{ s: string }>(db, `select project_stage($1) s`, [p])).s;
    expect(await stage()).toBe("active");
    const inv = await doc(db, { type: "invoice", date: "2026-03-10", contact: client, project: p, lines: [{ account: "4000", amount: 1000 }] });
    await db.query(`update projects set completed_at = '2026-04-01' where id = $1`, [p]);
    expect(await stage()).toBe("completed");
    await doc(db, { type: "customer_payment", date: "2026-04-10", contact: client, bank: "1010", total: 1000, apply: [{ to: inv, amount: 1000 }] });
    expect(await stage()).toBe("closed");
  });
});
