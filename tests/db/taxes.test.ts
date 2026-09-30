import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one, q, assertHealthy } from "./harness";
import { contact, doc } from "./books";

let db: PGlite;
let client: string;
let supplier: string;

const sale = (date: string, amount: number, tax: "STD" | "ZERO" | "EXEMPT" = "STD", type = "invoice") =>
  doc(db, { type, date, dueDate: "2026-12-31", contact: client, number: `INV-${date}-${amount}-${type}`, lines: [{ account: "4000", amount, tax }] });
const purchase = (date: string, amount: number, claimable = true) =>
  doc(db, { type: "bill", date, contact: supplier, supplierTin: "1000123GST501", taxInvoiceNo: `TI-${date}`, taxInvoiceDate: date,
    lines: [{ account: "5000", amount, tax: "STD", claimable }] });
const periodOf = async (date: string) => (await one<{ id: string }>(db, `select gst_period_for($1::date) id`, [date])).id;
type Row = { side: string; number: string | null; tin: string | null; tax_invoice_no: string | null; taxable: string | null; gst: string; late: boolean; correction: boolean };
const schedule = async (id: string) => (await q<Row>(db, `select * from gst_schedule($1)`, [id]))
  .map((r) => [r.side, r.taxable === null ? null : Number(r.taxable), Number(r.gst), r.late, r.correction]);

beforeEach(async () => {
  db = await freshDb();
  client = await contact(db, "Client", ["customer"]);
  supplier = await contact(db, "Supplier", ["vendor"], { tin: "1000123GST501", gst: true });
});
afterEach(async () => { await assertHealthy(db); });

describe("Taxes screens (024)", () => {
  it("the schedule lists each document with its taxable value and GST, and adds up to the return", async () => {
    await sale("2026-01-15", 10000);
    await sale("2026-02-01", 2000, "STD", "credit_note");
    await purchase("2026-02-10", 2000);
    await purchase("2026-02-11", 1000, false);   // not claimable: not in the input schedule
    const q1 = await periodOf("2026-02-01");
    const rows = await q<Row>(db, `select * from gst_schedule($1)`, [q1]);
    expect(await schedule(q1)).toEqual([
      ["output", 10000, 800, false, false],
      ["output", -2000, -160, false, false],
      ["input", 2000, 160, false, false],
    ]);
    expect(rows[2].tin).toBe("1000123GST501");
    expect(rows[2].tax_invoice_no).toBe("TI-2026-02-10");
    const t = await one<{ output: string; input: string }>(db, `select * from gst_totals($1)`, [q1]);
    const sum = (side: string) => rows.filter((r) => r.side === side).reduce((s, r) => s + Number(r.gst), 0);
    expect([sum("output"), sum("input")]).toEqual([Number(t.output), Number(t.input)]);
  });

  it("late documents and corrections to a filed return are flagged in the next one", async () => {
    const inv = await sale("2026-01-15", 10000);
    const q1 = await periodOf("2026-01-15");
    await db.transaction(async (tx) => { await tx.query(`select file_gst_period($1, 'R1')`, [q1]); });
    await purchase("2026-02-20", 1000);
    await db.transaction(async (tx) => {
      await tx.query(`update transaction_lines set amount = 12000 where transaction_id = $1`, [inv]);
      await tx.query(`select post_transaction($1)`, [inv]);
    });
    const q2 = await periodOf("2026-04-01");
    expect(await schedule(q2)).toEqual([
      ["output", null, 160, true, true],
      ["input", 1000, 80, true, false],
    ]);
    // the filed return's schedule is unchanged
    expect(await schedule(q1)).toEqual([["output", 10000, 800, false, false]]);
  });

  it("supplies by tax code count every rate, with credits negative", async () => {
    await sale("2026-01-15", 10000);
    await sale("2026-01-16", 3000, "ZERO");
    await sale("2026-01-17", 500, "EXEMPT");
    await sale("2026-01-18", 1000, "STD", "credit_note");
    await purchase("2026-02-10", 2000);
    await sale("2026-04-01", 999);            // outside the range
    const r = await q<{ side: string; kind: string; net: string; gst: string }>(db, `select * from gst_supplies('2026-01-01', '2026-03-31')`);
    expect(r.map((x) => [x.side, x.kind, Number(x.net), Number(x.gst)])).toEqual([
      ["sales", "exempt", 500, 0],
      ["sales", "standard", 9000, 720],
      ["sales", "zero", 3000, 0],
      ["purchases", "standard", 2000, 160],
    ]);
  });

  it("changing the due day moves the due date of returns not yet filed", async () => {
    await sale("2026-01-15", 1000);
    await sale("2026-04-15", 1000);
    const q1 = await periodOf("2026-01-15"), q2 = await periodOf("2026-04-15");
    await db.transaction(async (tx) => { await tx.query(`select file_gst_period($1, 'R1')`, [q1]); });
    await db.query(`update settings set gst_due_day = 20`);
    const due = async (id: string) => (await one<{ d: string }>(db, `select due_date::text d from tax_periods where id = $1`, [id])).d;
    expect(await due(q1)).toBe("2026-04-28");
    expect(await due(q2)).toBe("2026-07-20");
  });
});
