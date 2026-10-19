import { describe, it } from "vitest";
import fc from "fast-check";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";
import { accountId, contact, contactId, doc, project } from "./books";

/**
 * §13 property test: random but valid sequences of everyday work — sales,
 * payments, bills, voids, edits, payroll, GST returns, financing, completion,
 * bad debts and payouts — must always leave the books passing every invariant.
 * Business-rule refusals (e.g. a blocked payout) are fine; anything else fails.
 */

const WHT_FIXTURE = '[{"from": 0, "to": 20000, "rate": 0}, {"from": 20000, "to": null, "rate": 10}]';
const EXPECTED = /More is applied|more than|blocked|already|earlier return|owes|Nothing is owed|Payouts start|applied to this document|cannot be applied|Everyone in this run|is approved|A void document|less than nothing|recovering more|same contact|filed return|No such/;

const money = fc.integer({ min: 100, max: 80000 });
const day = fc.integer({ min: 0, max: 270 });
const idx = fc.nat({ max: 20 });
const op = fc.oneof(
  { weight: 4, arbitrary: fc.record({ k: fc.constant("invoice"), amount: money, proj: fc.nat({ max: 2 }), tax: fc.boolean(), day }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("pay"), i: idx, frac: fc.double({ min: 0.1, max: 1, noNaN: true }), day }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("bill"), amount: money, proj: fc.nat({ max: 2 }), claimable: fc.boolean(), day }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("payBill"), i: idx, day }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("expense"), amount: money, day }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("journal"), amount: money, day }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("void"), which: fc.constantFrom("inv", "bill", "pay"), i: idx }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("edit"), i: idx, amount: money }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("finance"), proj: fc.nat({ max: 2 }), amount: money, lender: fc.boolean(), day }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("complete"), proj: fc.nat({ max: 2 }), day }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("badDebt"), i: idx, day }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("payout"), proj: fc.nat({ max: 2 }), day }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("payroll"), month: fc.integer({ min: 1, max: 9 }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("fileGst") }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("advance"), amount: fc.integer({ min: 100, max: 3000 }), day }) },
);

const date = (d: number) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);

async function run(db: PGlite, ops: Record<string, unknown>[]) {
  const client = await contact(db, "Client", ["customer"]);
  const supplier = await contact(db, "Supplier", ["vendor"], { tin: "1000123GST501", gst: true });
  const lender = await contact(db, "Lender", ["lender"]);
  const mujahid = await contactId(db, "Mujahid");
  const projects = [await project(db, "Q-0", client, 500000), await project(db, "Q-1", client, 300000), await project(db, "Q-2", client, 200000)];
  await db.query(`update employees set active = false`);
  const emp = (await one<{ id: string }>(db, `insert into employees (name, department, basic_salary) values ('Site A', 'site', 15000) returning id`)).id;
  await db.transaction(async (tx) => {
    await tx.query(`insert into employee_allocations (employee_id, project_id, percent, effective_from) values ($1, $2, 70, '2026-01-01'), ($1, $3, 30, '2026-01-01')`, [emp, projects[0], projects[1]]);
  });
  await db.query(`insert into rates (kind, code, brackets, effective_from) values ('wht', 'default', $1, '2020-01-01')`, [WHT_FIXTURE]);
  const bank = await accountId(db, "1010");
  const inv: string[] = [], bills: string[] = [], pays: string[] = [];
  const pick = <T,>(xs: T[], i: number) => (xs.length ? xs[i % xs.length] : undefined);
  const open = async (id: string) => Number((await one<{ b: string }>(db, `select balance b from document_balances_v where id = $1`, [id])).b);

  for (const o of ops) {
    try {
      switch (o.k) {
        case "invoice":
          inv.push(await doc(db, { type: "invoice", date: date(o.day as number), dueDate: "2026-12-31", contact: client, project: projects[o.proj as number],
            lines: [{ account: "4000", amount: o.amount as number, tax: o.tax ? "STD" : "ZERO" }] }));
          break;
        case "pay": {
          const i = pick(inv, o.i as number);
          if (!i) break;
          const bal = await open(i);
          const amt = Math.round(bal * (o.frac as number) * 100) / 100;
          if (amt <= 0) break;
          pays.push(await doc(db, { type: "customer_payment", date: date(o.day as number), contact: client, bank: "1010", total: amt, apply: [{ to: i, amount: amt }] }));
          break;
        }
        case "bill":
          bills.push(await doc(db, { type: "bill", date: date(o.day as number), contact: supplier, project: projects[o.proj as number],
            supplierTin: "1000123GST501", taxInvoiceNo: `T${bills.length}`, taxInvoiceDate: date(o.day as number),
            lines: [{ account: "5000", amount: o.amount as number, tax: "STD", claimable: o.claimable as boolean }] }));
          break;
        case "payBill": {
          const b = pick(bills, o.i as number);
          if (!b) break;
          const bal = await open(b);
          if (bal <= 0) break;
          await doc(db, { type: "bill_payment", date: date(o.day as number), contact: supplier, bank: "1010", total: bal, apply: [{ to: b, amount: bal }] });
          break;
        }
        case "expense":
          await doc(db, { type: "expense", date: date(o.day as number), bank: "1030", lines: [{ account: "6110", amount: o.amount as number }] });
          break;
        case "journal":
          await doc(db, { type: "journal", date: date(o.day as number), lines: [{ account: "6130", debit: o.amount as number }, { account: "1010", credit: o.amount as number }] });
          break;
        case "void": {
          const list = o.which === "inv" ? inv : o.which === "bill" ? bills : pays;
          const id = pick(list, o.i as number);
          if (id) await db.transaction(async (tx) => { await tx.query(`select void_transaction($1, 'property test')`, [id]); });
          break;
        }
        case "edit": {
          const id = pick(inv, o.i as number);
          if (!id) break;
          await db.transaction(async (tx) => {
            await tx.query(`update transaction_lines set amount = $2 where transaction_id = $1`, [id, o.amount]);
            await tx.query(`select post_transaction($1)`, [id]);
          });
          break;
        }
        case "finance":
          await doc(db, { type: o.lender ? "loan_receipt" : "capital_contribution", date: date(o.day as number), contact: o.lender ? lender : mujahid,
            project: projects[o.proj as number], bank: "1010", total: o.amount as number });
          break;
        case "complete":
          await db.transaction(async (tx) => { await tx.query(`select complete_project($1, $2)`, [projects[o.proj as number], date(o.day as number)]); });
          break;
        case "badDebt": {
          const i = pick(inv, o.i as number);
          if (!i) break;
          const bal = await open(i);
          if (bal <= 0) break;
          await doc(db, { type: "bad_debt", date: date(o.day as number), contact: client, total: bal, apply: [{ to: i, amount: bal }] });
          break;
        }
        case "payout": {
          const p = projects[o.proj as number];
          const owed = await q<{ contact_id: string; component: string; outstanding: string }>(db,
            `select contact_id, component, outstanding from partner_statement_v where project_id = $1 and outstanding > 0`, [p]);
          if (!owed.length) break;
          const w = owed[0];
          await doc(db, { type: "payout", date: date(o.day as number), contact: w.contact_id, project: p, bank: "1010",
            lines: [{ component: w.component as "principal", amount: Number(w.outstanding) }] });
          break;
        }
        case "payroll": {
          const month = `2026-${String(o.month).padStart(2, "0")}-01`;
          if ((await q(db, `select 1 from payroll_runs where period_month = $1`, [month])).length) break;
          await db.transaction(async (tx) => {
            const run = (await one<{ id: string }>(tx, `select create_payroll_run($1, $1::date + 27) id`, [month])).id;
            await tx.query(`select approve_payroll_run($1)`, [run]);
            await tx.query(`select pay_salaries($1, $2, $3::date + 27)`, [run, bank, month]);
          });
          break;
        }
        case "fileGst": {
          const next = await q<{ id: string }>(db, `select p.id from tax_periods p where p.status = 'open'
            and exists (select 1 from journal_lines j where j.tax_period_id = p.id) order by p.start_date limit 1`);
          if (!next.length) break;
          await db.transaction(async (tx) => {
            await tx.query(`select file_gst_period($1, 'test')`, [next[0].id]);
            const owed = Number((await one<{ v: string }>(tx, `select gst_payable($1) v`, [next[0].id])).v);
            if (owed > 0) await tx.query(`select pay_gst_period($1, $2, current_date)`, [next[0].id, bank]);
          });
          break;
        }
        case "advance":
          await doc(db, { type: "staff_advance", date: date(o.day as number), employee: emp, bank: "1010", total: o.amount as number });
          break;
      }
    } catch (e) {
      const m = (e as Error).message;
      if (!EXPECTED.test(m)) throw new Error(`${o.k} failed unexpectedly: ${m}\n${JSON.stringify(o)}`);
    }
  }
  await assertHealthy(db);
}

describe("property: random valid sequences keep every invariant", () => {
  it("holds for 25 random sequences of up to 30 steps", async () => {
    await fc.assert(fc.asyncProperty(fc.array(op, { minLength: 5, maxLength: 30 }), async (ops) => {
      const db = await freshDb();
      try { await run(db, ops); } finally { await db.close(); }
    }), { numRuns: 25, seed: 20260928, endOnFailure: true });
  }, 600_000);
});
