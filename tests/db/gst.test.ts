import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one, assertHealthy } from "./harness";
import { accountId, balance, contact, doc, journal } from "./books";

let db: PGlite;
let client: string;
let supplier: string;

const evidence = { supplierTin: "1000123GST501", taxInvoiceNo: "TI-1", taxInvoiceDate: "2026-02-10" };
const sale = (date: string, amount: number) =>
  doc(db, { type: "invoice", date, dueDate: "2026-12-31", contact: client, lines: [{ account: "4000", amount, tax: "STD" }] });
const purchase = (date: string, amount: number, claimable = true) =>
  doc(db, { type: "bill", date, contact: supplier, ...evidence, taxInvoiceDate: date,
    lines: [{ account: "5000", amount, tax: "STD", claimable }] });
const periodOf = async (date: string) =>
  (await one<{ id: string }>(db, `select id from tax_periods where $1::date between start_date and end_date`, [date])).id;
const totals = async (id: string) => {
  const t = await one<{ output: string; input: string; net: string }>(db, `select * from gst_totals($1)`, [id]);
  return [Number(t.output), Number(t.input), Number(t.net)];
};
const file = (id: string) => db.transaction(async (tx) => (await one<{ id: string }>(tx, `select file_gst_period($1, 'MIRA-REF') id`, [id])).id);

beforeEach(async () => {
  db = await freshDb();
  client = await contact(db, "Client", ["customer"]);
  supplier = await contact(db, "Supplier", ["vendor"], { tin: "1000123GST501", gst: true });
});

afterEach(async () => { await assertHealthy(db); });

describe("GST quarters (§8)", () => {
  it("adds up each quarter's output and input tax; non-claimable GST is not input tax", async () => {
    await sale("2026-01-15", 10000);            // 800 output
    await sale("2026-03-31", 5000);             // 400 output
    await purchase("2026-02-10", 2000);         // 160 input
    await purchase("2026-02-11", 1000, false);  // 80 into cost, not input
    await sale("2026-04-01", 1000);             // next quarter
    const q1 = await periodOf("2026-02-01");
    expect(await totals(q1)).toEqual([1200, 160, 1040]);
    expect(await totals(await periodOf("2026-04-01"))).toEqual([80, 0, 80]);
    const q = await one<{ s: string; e: string; d: string }>(db, `select start_date::text s, end_date::text e, due_date::text d from tax_periods where id = $1`, [q1]);
    expect([q.s, q.e, q.d]).toEqual(["2026-01-01", "2026-03-31", "2026-04-28"]);
  });

  it("filing posts the settlement, which zeroes the quarter's output and input; paying MIRA clears the payable", async () => {
    await sale("2026-01-15", 10000);
    await purchase("2026-02-10", 2000);
    const q1 = await periodOf("2026-01-15");
    const settlement = await file(q1);
    expect(await journal(db, settlement)).toEqual([["1200", 0, 160], ["2100", 800, 0], ["2110", 0, 640]]);
    expect([await balance(db, "2100"), await balance(db, "1200"), await balance(db, "2110")]).toEqual([0, 0, -640]);
    await db.transaction(async (tx) => { await tx.query(`select pay_gst_period($1, $2, '2026-04-25')`, [q1, await accountId(tx, "1010")]); });
    expect(await balance(db, "2110")).toBe(0);
    expect((await one<{ s: string }>(db, `select status s from tax_periods where id = $1`, [q1])).s).toBe("paid");
  });

  it("a filed quarter is locked: late and edited documents go into the next open return", async () => {
    const inv = await sale("2026-01-15", 10000);
    const q1 = await periodOf("2026-01-15");
    await file(q1);
    // a bill dated in the filed quarter lands in Q2 as an adjustment
    await purchase("2026-02-20", 1000);
    const q2 = await periodOf("2026-04-01").catch(async () => (await one<{ id: string }>(db, `select gst_period_for('2026-04-01') id`)).id);
    expect(await totals(q2)).toEqual([0, 80, -80]);
    // editing the filed invoice: only the difference goes to Q2
    await db.transaction(async (tx) => {
      await tx.query(`update transaction_lines set amount = 12000 where transaction_id = $1`, [inv]);
      await tx.query(`select post_transaction($1)`, [inv]);
    });
    expect(await totals(q2)).toEqual([160, 80, 80]);
    // what was filed never changes
    const filed = await one<{ output_total: string }>(db, `select output_total from tax_periods where id = $1`, [q1]);
    expect(Number(filed.output_total)).toBe(800);
    expect(await totals(q1)).toEqual([800, 0, 800]);
    // voiding it reverses the whole filed amount in the open return
    await db.transaction(async (tx) => { await tx.query(`select void_transaction($1, 'cancelled')`, [inv]); });
    expect(await totals(q2)).toEqual([-800, 80, -880]);
    // and the filed lines themselves cannot be touched
    await expect(db.query(`delete from journal_lines where tax_period_id = $1`, [q1])).rejects.toThrow(/return is filed/);
  });

  it("input above output is carried forward and used against the next return", async () => {
    await purchase("2026-02-10", 5000);        // 400 input
    await sale("2026-02-15", 1000);            // 80 output
    const q1 = await periodOf("2026-02-10");
    const s1 = await file(q1);
    expect(await journal(db, s1)).toEqual([["1200", 0, 400], ["1210", 320, 0], ["2100", 80, 0]]);
    expect((await one<{ s: string }>(db, `select status s from tax_periods where id = $1`, [q1])).s).toBe("paid");
    await sale("2026-05-01", 10000);           // 800 output in Q2
    const q2 = await periodOf("2026-05-01");
    const s2 = await file(q2);
    expect(await journal(db, s2)).toEqual([["1210", 0, 320], ["2100", 800, 0], ["2110", 0, 480]]);
    expect(await balance(db, "1210")).toBe(0);
  });

  it("returns are filed in order", async () => {
    await sale("2026-01-15", 1000);
    await sale("2026-04-15", 1000);
    await expect(file(await periodOf("2026-04-15"))).rejects.toThrow(/earlier return first/);
  });
});
