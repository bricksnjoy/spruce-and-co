import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one, q, assertHealthy } from "./harness";
import { accountId, balance, doc, journal, project } from "./books";

let db: PGlite;
let site: string;
let admin: string;
let p1: string;
let p2: string;

// A TEST FIXTURE, not the real MIRA table (decision Y4 still needs your figures): 0% to 20,000 a month, 10% above.
const WHT_FIXTURE = '[{"from": 0, "to": 20000, "rate": 0}, {"from": 20000, "to": null, "rate": 10}]';

beforeEach(async () => {
  db = await freshDb();
  await db.query(`update employees set active = false`);
  p1 = await project(db, "PR-1", null, 0);
  p2 = await project(db, "PR-2", null, 0);
  site = (await one<{ id: string }>(db, `insert into employees (name, nationality_type, department, basic_salary) values ('Ahmed', 'maldivian', 'site', 20000) returning id`)).id;
  admin = (await one<{ id: string }>(db, `insert into employees (name, nationality_type, department, basic_salary) values ('Ravi', 'expatriate', 'admin', 30000) returning id`)).id;
  await db.query(`insert into employee_pay_items (employee_id, pay_item_id, amount) select $1, id, 3000 from pay_items where code = 'ISLAND'`, [site]);
  await db.transaction(async (tx) => {
    await tx.query(`insert into employee_allocations (employee_id, project_id, percent, effective_from) values ($1, $2, 60, '2026-01-01'), ($1, $3, 40, '2026-01-01')`, [site, p1, p2]);
  });
  await db.query(`insert into rates (kind, code, brackets, effective_from) values ('wht', 'default', $1, '2020-01-01')`, [WHT_FIXTURE]);
  // a 2,000 advance, recovered at 500 a month
  const adv = await doc(db, { type: "staff_advance", date: "2026-02-15", employee: site, bank: "1010", total: 2000 });
  await db.query(`insert into advance_recoveries (employee_id, advance_transaction_id, instalment, start_month) values ($1, $2, 500, '2026-03-01')`, [site, adv]);
});

afterEach(async () => { await assertHealthy(db); });

async function marchRun() {
  const run = await db.transaction(async (tx) => (await one<{ id: string }>(tx, `select create_payroll_run('2026-03-01', '2026-03-31') id`)).id);
  const slip = (await one<{ id: string }>(db, `select id from payslips where run_id = $1 and employee_id = $2`, [run, site])).id;
  // 10 hours' overtime at 150, 2 days' no-pay
  await db.query(`insert into payslip_lines (payslip_id, pay_item_id, quantity, rate) select $1, id, 10, 150 from pay_items where code = 'OVERTIME'`, [slip]);
  await db.query(`insert into payslip_lines (payslip_id, pay_item_id, quantity) select $1, id, 2 from pay_items where code = 'NOPAY'`, [slip]);
  await db.query(`select calc_payslip($1)`, [slip]);
  return { run, slip };
}

describe("payroll (§7)", () => {
  it("gross to net: allowances, overtime, no-pay, pension 7%/7% for Maldivians, WHT by brackets, advance recovery", async () => {
    const { slip } = await marchRun();
    const s = await one<Record<string, string>>(db, `select gross, deductions, employer_contributions, net from payslips where id = $1`, [slip]);
    // earnings 20,000 + 3,000 + 1,500 = 24,500; no-pay 2 × 20,000/30 = 1,333.33 → gross 23,166.67
    // pension base 20,000 − 1,333.33 = 18,666.67 → 1,306.67 each; WHT (23,166.67 − 20,000) × 10% = 316.67
    expect(Number(s.gross)).toBe(23166.67);
    expect(Number(s.employer_contributions)).toBe(1306.67);
    expect(Number(s.deductions)).toBe(500 + 1306.67 + 316.67);
    expect(Number(s.net)).toBe(21043.33);
    const ravi = await one<Record<string, string>>(db, `select gross, deductions, employer_contributions, net from payslips where employee_id = $1`, [admin]);
    // expatriate: no pension; WHT (30,000 − 20,000) × 10%
    expect([Number(ravi.gross), Number(ravi.deductions), Number(ravi.employer_contributions), Number(ravi.net)]).toEqual([30000, 1000, 0, 29000]);
  });

  it("approval posts site labour to each project and admin to overhead; everything balances", async () => {
    const { run } = await marchRun();
    const txn = await db.transaction(async (tx) => (await one<{ id: string }>(tx, `select approve_payroll_run($1) id`, [run])).id);
    expect(await journal(db, txn)).toEqual([
      ["1300", 0, 500], ["2200", 0, 50043.33], ["2210", 0, 2613.34], ["2220", 0, 1316.67], ["5020", 24473.34, 0], ["6000", 30000, 0]]);
    expect(await balance(db, "5020", { project: p1 })).toBe(14684);
    expect(await balance(db, "5020", { project: p2 })).toBe(9789.34);
    expect(await balance(db, "1300", { employee: site })).toBe(1500);
    // an approved run is frozen
    await expect(db.query(`update payslip_lines set amount = 1 where payslip_id in (select id from payslips where run_id = $1)`, [run]))
      .rejects.toThrow(/approved/);
  });

  it("salary payment and remittances clear their payables; the run then shows as paid", async () => {
    const { run } = await marchRun();
    await db.transaction(async (tx) => { await tx.query(`select approve_payroll_run($1)`, [run]); });
    const bank = await accountId(db, "1010");
    await db.transaction(async (tx) => { await tx.query(`select pay_salaries($1, $2, '2026-03-31')`, [run, bank]); });
    expect(await balance(db, "2200")).toBe(0);
    await doc(db, { type: "payroll_remittance", date: "2026-04-10", bank: "1010", lines: [{ account: "2210", amount: 2613.34 }, { account: "2220", amount: 1316.67 }] });
    expect([await balance(db, "2210"), await balance(db, "2220")]).toEqual([0, 0]);
    expect((await one<{ s: string }>(db, `select display_status s from payroll_runs_v where id = $1`, [run])).s).toBe("paid");
  });

  it("allocations must total 100%", async () => {
    await expect(db.transaction(async (tx) => {
      await tx.query(`insert into employee_allocations (employee_id, project_id, percent, effective_from) values ($1, $2, 50, '2026-04-01'), ($1, $3, 30, '2026-04-01')`, [admin, p1, p2]);
    })).rejects.toThrow(/total 100/);
    const { run, slip } = await marchRun();
    await db.query(`update labour_allocations set quantity = 30 where payslip_id = $1 and project_id = $2`, [slip, p2]);
    await expect(db.transaction(async (tx) => { await tx.query(`select approve_payroll_run($1)`, [run]); })).rejects.toThrow(/allocated 90/);
  });

  it("refuses to run payroll without withholding-tax brackets", async () => {
    await db.query(`delete from rates where kind = 'wht'`);
    await expect(db.query(`select create_payroll_run('2026-03-01', '2026-03-31')`)).rejects.toThrow(/withholding-tax brackets/);
  });

  it("recovers no more than the employee still owes", async () => {
    await db.query(`update advance_recoveries set instalment = 5000`);
    const { slip } = await marchRun();
    const r = await q<{ amount: string }>(db, `select pl.amount from payslip_lines pl join pay_items pi on pi.id = pl.pay_item_id where pl.payslip_id = $1 and pi.code = 'ADVANCE'`, [slip]);
    expect(Number(r[0].amount)).toBe(2000);
  });
});
