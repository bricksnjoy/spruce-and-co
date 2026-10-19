import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/**
 * The end-to-end flows of §13, driven through the same rpc_ doors the screens
 * use, signed in as an admin. Every flow ends with the statements tying out
 * and the full health check passing.
 */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const MANAGER = "00000000-0000-0000-0000-00000000000b";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const save = (p: object, uid = ADMIN) => as(uid, () => one<{ id: string }>(db, `select rpc_save_transaction($1::jsonb) id`, [JSON.stringify(p)])).then((r) => r.id);
const rpc = <T = unknown>(sql: string, args: unknown[] = [], uid = ADMIN) => as(uid, () => one<T & Record<string, unknown>>(db, sql, args));
const id = async (sql: string, args: unknown[] = []) => (await one<{ id: string }>(db, sql, args)).id;
const n = (v: unknown) => Number(v ?? 0);

let acct: Record<string, string>;
let std: string, bank: string, client: string, vendor: string, lender: string, mujahid: string;

beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Manager', 'manager')`, [ADMIN, MANAGER]);
  await db.query(`insert into rates (kind, code, brackets, effective_from) values ('wht', 'default', '[{"from": 0, "to": null, "rate": 0}]', '2020-01-01')`);
  await db.query(`update employees set active = false`);
  acct = Object.fromEntries((await q<{ code: string; id: string }>(db, `select code, id from accounts where parent_id is null`)).map((r) => [r.code, r.id]));
  bank = acct["1010"];
  std = await id(`select id from tax_codes where code = 'STD'`);
  client = await id(`insert into contacts (name, kinds, tin) values ('Resort Pvt Ltd', '{customer}', '1000111GST501') returning id`);
  vendor = await id(`insert into contacts (name, kinds, tin, gst_registered) values ('Timber Ltd', '{vendor}', '1000222GST501', true) returning id`);
  lender = await id(`insert into contacts (name, kinds) values ('Island Finance', '{lender}') returning id`);
  mujahid = await id(`select id from contacts where name = 'Mujahid'`);
});
afterEach(async () => { await assertHealthy(db); });

/** Steps 1–6 of the lifecycle: a project with budget, variation, GST invoices, bills, payroll and financing. */
async function buildProject(code: string) {
  const p = await id(`insert into projects (code, name, customer_id, contract_value, status, start_date) values ($1, 'Villa fit-out', $2, 500000, 'in_progress', '2026-01-01') returning id`, [code, client]);
  await db.query(`insert into budget_lines (project_id, description, budget_category, budget_amount) values ($1, 'Timber', 'materials', 200000), ($1, 'Site team', 'labour', 60000)`, [p]);
  await db.query(`insert into variations (project_id, title, status, amount, raised_date, approved_date) values ($1, 'Extra deck', 'approved', 50000, '2026-02-01', '2026-02-05')`, [p]);
  // progress invoices with GST
  const inv1 = await save({ type: "invoice", date: "2026-02-15", due_date: "2026-03-15", contact_id: client, project_id: p, lines: [{ account_id: acct["4000"], amount: 300000, tax_code_id: std }] });
  const inv2 = await save({ type: "invoice", date: "2026-05-15", due_date: "2026-06-15", contact_id: client, project_id: p, lines: [{ account_id: acct["4000"], amount: 250000, tax_code_id: std }] });
  // bills: one with claimable GST, one where the GST is not claimable
  await save({ type: "bill", date: "2026-02-20", contact_id: vendor, project_id: p, supplier_tin: "1000222GST501", tax_invoice_no: "TL-1", tax_invoice_date: "2026-02-20",
    lines: [{ account_id: acct["5000"], amount: 150000, tax_code_id: std, gst_claimable: true, project_id: p }] });
  await save({ type: "bill", date: "2026-03-10", contact_id: vendor, project_id: p, supplier_tin: "1000222GST501", tax_invoice_no: "TL-2", tax_invoice_date: "2026-03-10",
    lines: [{ account_id: acct["5050"], amount: 20000, tax_code_id: std, gst_claimable: false, project_id: p }] });
  // payroll: a site employee allocated wholly to the project
  const emp = await id(`insert into employees (name, basic_salary, nationality_type, department, wht_applicable) values ('Site lead', 12000, 'expatriate', 'site', false) returning id`);
  await db.query(`insert into employee_allocations (employee_id, project_id, percent, effective_from) values ($1, $2, 100, '2026-01-01')`, [emp, p]);
  const run = (await rpc<{ id: string }>(`select rpc_create_payroll_run('2026-04-01', '2026-04-30') id`)).id;
  await rpc(`select rpc_approve_payroll_run($1) x`, [run]);
  await rpc(`select rpc_pay_salaries($1, $2, '2026-04-30') x`, [run, bank]);
  // financing: Capital Pool and an external lender
  await save({ type: "capital_contribution", date: "2026-01-10", contact_id: mujahid, project_id: p, bank_account_id: bank, total_amount: 200000 });
  await save({ type: "loan_receipt", date: "2026-01-12", contact_id: lender, project_id: p, bank_account_id: bank, total_amount: 100000 });
  return { p, inv1, inv2, run };
}
const invTotal = async (inv: string) => n((await one<{ t: string }>(db, `select total t from document_balances_v where id = $1`, [inv])).t);
const pay = (inv: string, amount: number, date: string) =>
  save({ type: "customer_payment", date, contact_id: client, bank_account_id: bank, total_amount: amount, applications: [{ to: inv, amount }] });
const statement = async (who: string, p: string) => Object.fromEntries((await q<{ component: string; outstanding: string }>(db,
  `select component, outstanding from partner_statement_v where contact_id = $1 and project_id = $2`, [who, p])).map((r) => [r.component, n(r.outstanding)]));

/** Every statement ties to the ledger and to each other. */
async function tiesOut(p: string) {
  const tb = await q<{ type: string; closing: string }>(db, `select type::text, closing from report_tb('2026-01-01', '2026-12-31')`);
  expect(tb.reduce((t, r) => t + n(r.closing), 0)).toBeCloseTo(0, 2);
  const cf = await q<{ section: string; amount: string }>(db, `select section, amount from cash_flow('2026-01-01', '2026-12-31')`);
  const flows = cf.filter((r) => ["operating", "investing", "financing", "opening_balances"].includes(r.section)).reduce((t, r) => t + n(r.amount), 0);
  expect(n(cf.find((r) => r.section === "cash_start")?.amount) + flows).toBeCloseTo(n(cf.find((r) => r.section === "cash_end")?.amount), 2);
  const eq = await one<{ total: string }>(db, `select total from equity_changes('2026-01-01', '2026-12-31') where sort = 9`);
  const netAssets = tb.filter((r) => r.type === "asset" || r.type === "liability").reduce((t, r) => t + n(r.closing), 0);
  expect(n(eq.total)).toBeCloseTo(netAssets, 2);
  // project profit from the project's figures = its P&L lines in the ledger (before the split)
  const fig = await one<{ actual_profit: string }>(db, `select actual_profit from project_list_v where id = $1`, [p]);
  const byProj = await one<{ v: string }>(db, `select coalesce(sum(amount), 0)::text v from report_by('2026-01-01', '2026-12-31', 'project') r
    join accounts a on a.id = r.account_id where r.dim_id = $1 and a.subtype not in ('finance_cost', 'profit_share')`, [p]);
  expect(n(fig.actual_profit)).toBeCloseTo(n(byProj.v), 2);
}

describe("full project lifecycle (§13)", () => {
  it("builds, completes, blocks payouts until paid, releases them, pays all three components, and ties out", async () => {
    const { p, inv1, inv2 } = await buildProject("LC-1");
    const t1 = await invTotal(inv1), t2 = await invTotal(inv2);
    expect(t1).toBeGreaterThan(300000); // GST on top
    // the variation raised the contract; labour reached the project
    const fig = await one<{ revised: string; cost_to_date: string }>(db, `select revised, cost_to_date from project_list_v where id = $1`, [p]);
    expect(n(fig.revised)).toBe(550000);
    expect(n(fig.cost_to_date)).toBeGreaterThanOrEqual(150000 + 20000 + 12000);

    await pay(inv1, t1, "2026-03-01"); // partial: the second invoice is still open
    await rpc(`select rpc_complete_project($1, '2026-06-30') x`, [p]);
    const line = (component: string, amount: number) => ({ project_id: p, component, amount });
    await expect(rpc(`select rpc_save_payout($1::jsonb) x`, [JSON.stringify({ date: "2026-07-01", contact_id: mujahid, bank_account_id: bank, lines: [line("principal", 1000)] })]))
      .rejects.toThrow(/client still owes/);
    expect((await one<{ blocked: boolean }>(db, `select blocked from payout_status($1)`, [p])).blocked).toBe(true);

    await pay(inv2, t2, "2026-07-05");
    expect((await one<{ blocked: boolean; stage: string }>(db, `select blocked, stage from project_payouts_v where id = $1`, [p]))).toEqual({ blocked: false, stage: "settled" });

    const owed = await statement(mujahid, p);
    expect(owed.financing_return).toBeGreaterThan(0);
    expect(owed.profit_share).toBeGreaterThan(0);
    await rpc(`select rpc_save_payout($1::jsonb) x`, [JSON.stringify({ date: "2026-07-10", contact_id: mujahid, bank_account_id: bank,
      lines: [line("principal", owed.principal), line("financing_return", owed.financing_return), line("profit_share", owed.profit_share)] })]);
    expect(await statement(mujahid, p)).toEqual({ principal: 0, financing_return: 0, profit_share: 0 });
    await tiesOut(p);
  });
});

describe("GST quarter (§13)", () => {
  it("files Q1, posts the settlement, pays MIRA, and locks the quarter", async () => {
    const { p } = await buildProject("GQ-1");
    const q1 = (await rpc<{ id: string }>(`select rpc_gst_period('2026-02-15') id`)).id;
    const before = await one<{ output: string; input: string; net: string }>(db, `select output, input, net from gst_periods_v where id = $1`, [q1]);
    expect(n(before.output)).toBeGreaterThan(0);
    expect(n(before.input)).toBeGreaterThan(0); // only the claimable bill
    await expect(rpc(`select rpc_file_gst($1, 'MIRA-1') x`, [q1], MANAGER)).resolves.toBeDefined();
    const filed = await one<{ status: string; settlement_transaction_id: string | null }>(db, `select status, settlement_transaction_id from tax_periods where id = $1`, [q1]);
    expect(filed.status).toBe("filed");
    expect(filed.settlement_transaction_id).not.toBeNull();
    await rpc(`select rpc_pay_gst($1, $2, '2026-04-25') x`, [q1, bank]);
    expect((await one<{ status: string }>(db, `select status from tax_periods where id = $1`, [q1])).status).toBe("paid");
    // the quarter is locked: a sale dated in it goes into the next open return, flagged late
    const late = await save({ type: "invoice", date: "2026-03-20", due_date: "2026-04-20", contact_id: client, project_id: p, lines: [{ account_id: acct["4000"], amount: 1000, tax_code_id: std }] });
    const period = await one<{ start_date: string }>(db, `select tp.start_date::text from journal_lines j join tax_periods tp on tp.id = j.tax_period_id
      join accounts a on a.id = j.account_id where j.transaction_id = $1 and a.subtype = 'gst_output'`, [late]);
    expect(period.start_date).toBe("2026-04-01");
    expect(n((await one<{ output: string }>(db, `select output from gst_periods_v where id = $1`, [q1])).output)).toBe(n(before.output));
    await tiesOut(p);
  });
});

describe("bad-debt path (§13)", () => {
  it("writes off the final invoice: the split adjusts and payouts are released", async () => {
    const { p, inv1, inv2 } = await buildProject("BD-1");
    await pay(inv1, await invTotal(inv1), "2026-03-01");
    await rpc(`select rpc_complete_project($1, '2026-06-30') x`, [p]);
    const base = await one<{ profit_amount: string }>(db, `select profit_amount from distributions where project_id = $1 and reason = 'completion'`, [p]);
    await save({ type: "bad_debt", date: "2026-08-01", contact_id: client, total_amount: await invTotal(inv2), applications: [{ to: inv2, amount: await invTotal(inv2) }] });
    const adj = await one<{ reason: string; profit_amount: string }>(db, `select reason, profit_amount from distributions where project_id = $1 and reason <> 'completion'`, [p]);
    expect(adj.reason).toBe("bad_debt");
    expect(n(adj.profit_amount)).toBeLessThan(n(base.profit_amount));
    expect((await one<{ blocked: boolean }>(db, `select blocked from payout_status($1)`, [p])).blocked).toBe(false);
    await tiesOut(p);
  });
});
