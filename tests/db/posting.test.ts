import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one } from "./harness";
import { balance, contact, doc, journal, project, status } from "./books";

let db: PGlite;
let client: string;
let supplier: string;
let unregistered: string;
let p1: string;

beforeEach(async () => {
  db = await freshDb();
  client = await contact(db, "Client One", ["customer"]);
  supplier = await contact(db, "Registered Supplier", ["vendor"], { tin: "1000123GST501", gst: true });
  unregistered = await contact(db, "Small Shop", ["vendor"]);
  p1 = await project(db, "P-001", client, 100000);
});

const invoice = (amount: number, extra: Partial<Parameters<typeof doc>[1]> = {}) =>
  doc(db, { type: "invoice", date: "2026-03-10", dueDate: "2026-12-31", contact: client, project: p1,
    lines: [{ account: "4000", qty: 1, rate: amount, tax: "STD" }], ...extra });

describe("posting rules (§3): every rule gives these exact lines, and they balance", () => {
  it("1 · invoice: Dr AR, Cr revenue and GST output (8% from 2023)", async () => {
    const id = await invoice(10000);
    expect(await journal(db, id)).toEqual([["1100", 10800, 0], ["2100", 0, 800], ["4000", 0, 10000]]);
    expect(await balance(db, "1100", { project: p1 })).toBe(10800);
  });

  it("2 · payment received into Undeposited Funds, applied to the invoice; status follows", async () => {
    const inv = await invoice(10000);
    expect(await status(db, inv)).toBe("open");
    const pay = await doc(db, { type: "customer_payment", date: "2026-03-20", contact: client, total: 4000, apply: [{ to: inv, amount: 4000 }] });
    expect(await journal(db, pay)).toEqual([["1040", 4000, 0], ["1100", 0, 4000]]);
    expect(await status(db, inv)).toBe("partial");
    await doc(db, { type: "customer_payment", date: "2026-03-25", contact: client, bank: "1010", total: 6800, apply: [{ to: inv, amount: 6800 }] });
    expect(await status(db, inv)).toBe("paid");
    expect(await balance(db, "1100", { project: p1 })).toBe(0);
  });

  it("3 · bank deposit moves undeposited funds to the bank", async () => {
    const id = await doc(db, { type: "deposit", date: "2026-03-21", bank: "1010", total: 4000 });
    expect(await journal(db, id)).toEqual([["1010", 4000, 0], ["1040", 0, 4000]]);
  });

  it("4 · sales receipt: Dr bank, Cr revenue and GST", async () => {
    const id = await doc(db, { type: "sales_receipt", date: "2026-03-10", bank: "1030", lines: [{ account: "4900", amount: 500, tax: "STD" }] });
    expect(await journal(db, id)).toEqual([["1030", 540, 0], ["2100", 0, 40], ["4900", 0, 500]]);
  });

  it("5 · credit note: Dr revenue and GST, Cr AR; applied, it settles the invoice", async () => {
    const inv = await invoice(1000);
    const cn = await doc(db, { type: "credit_note", date: "2026-03-12", contact: client, project: p1,
      lines: [{ account: "4000", amount: 1000, tax: "STD" }], apply: [{ to: inv, amount: 1080 }] });
    expect(await journal(db, cn)).toEqual([["1100", 0, 1080], ["2100", 80, 0], ["4000", 1000, 0]]);
    expect(await status(db, inv)).toBe("paid");
  });

  it("6, 7 · client advance, then applied to an invoice", async () => {
    const adv = await doc(db, { type: "customer_advance", date: "2026-02-01", contact: client, project: p1, bank: "1010", total: 5000 });
    expect(await journal(db, adv)).toEqual([["1010", 5000, 0], ["2400", 0, 5000]]);
    const inv = await invoice(10000);
    const app = await doc(db, { type: "advance_application", date: "2026-03-10", contact: client, total: 5000, apply: [{ to: inv, amount: 5000 }] });
    expect(await journal(db, app)).toEqual([["1100", 0, 5000], ["2400", 5000, 0]]);
    expect(await status(db, inv)).toBe("partial");
  });

  it("8 · bill with claimable GST: cost + GST input, Cr AP", async () => {
    const id = await doc(db, { type: "bill", date: "2026-03-05", contact: supplier, project: p1,
      supplierTin: "1000123GST501", taxInvoiceNo: "TI-77", taxInvoiceDate: "2026-03-05",
      lines: [{ account: "5000", amount: 2000, tax: "STD", claimable: true }] });
    expect(await journal(db, id)).toEqual([["1200", 160, 0], ["2000", 0, 2160], ["5000", 2000, 0]]);
  });

  it("9 · bill without claimable GST: the GST is part of the cost", async () => {
    const id = await doc(db, { type: "bill", date: "2026-03-05", contact: unregistered, project: p1,
      lines: [{ account: "5000", amount: 2000, taxAmount: 160 }] });
    expect(await journal(db, id)).toEqual([["2000", 0, 2160], ["5000", 2160, 0]]);
  });

  it("§8 · input GST cannot be claimed without a TIN and tax invoice number, or from an unregistered supplier", async () => {
    await expect(doc(db, { type: "bill", date: "2026-03-05", contact: supplier,
      lines: [{ account: "5000", amount: 2000, tax: "STD", claimable: true }] })).rejects.toThrow(/TIN, tax invoice number and date/);
    await expect(doc(db, { type: "bill", date: "2026-03-05", contact: unregistered,
      supplierTin: "X", taxInvoiceNo: "1", taxInvoiceDate: "2026-03-05",
      lines: [{ account: "5000", amount: 2000, tax: "STD", claimable: true }] })).rejects.toThrow(/GST-registered supplier/);
    // customs GST on imports is claimed with the declaration as evidence (G5)
    const id = await doc(db, { type: "bill", date: "2026-03-05", contact: supplier, customsRef: "C-2026-551",
      lines: [{ account: "5000", amount: 1000, taxAmount: 80, claimable: true }] });
    expect(await journal(db, id)).toEqual([["1200", 80, 0], ["2000", 0, 1080], ["5000", 1000, 0]]);
  });

  it("10 · pay bill: Dr AP, Cr bank; the bill is paid", async () => {
    const bill = await doc(db, { type: "bill", date: "2026-03-05", contact: unregistered, project: p1, lines: [{ account: "5000", amount: 700 }] });
    const pay = await doc(db, { type: "bill_payment", date: "2026-03-30", contact: unregistered, bank: "1010", total: 700, apply: [{ to: bill, amount: 700 }] });
    expect(await journal(db, pay)).toEqual([["1010", 0, 700], ["2000", 700, 0]]);
    expect(await status(db, bill)).toBe("paid");
    expect(await balance(db, "2000", { project: p1 })).toBe(0);
  });

  it("11 · expense on the credit card", async () => {
    const id = await doc(db, { type: "expense", date: "2026-03-05", bank: "2010", lines: [{ account: "6110", amount: 300 }] });
    expect(await journal(db, id)).toEqual([["2010", 0, 300], ["6110", 300, 0]]);
  });

  it("12 · vendor credit: Dr AP, Cr cost and GST input", async () => {
    const id = await doc(db, { type: "vendor_credit", date: "2026-03-06", contact: supplier,
      supplierTin: "1000123GST501", taxInvoiceNo: "CN-4", taxInvoiceDate: "2026-03-06",
      lines: [{ account: "5000", amount: 500, tax: "STD", claimable: true }] });
    expect(await journal(db, id)).toEqual([["1200", 0, 40], ["2000", 540, 0], ["5000", 0, 500]]);
  });

  it("13 · transfer between banks", async () => {
    const id = await doc(db, { type: "transfer", date: "2026-03-05", bank: "1010", total: 1000, lines: [{ account: "1030" }] });
    expect(await journal(db, id)).toEqual([["1010", 0, 1000], ["1030", 1000, 0]]);
  });

  it("14 · manual journal must balance, or the database refuses it", async () => {
    const ok = await doc(db, { type: "journal", date: "2026-03-05", lines: [{ account: "6130", debit: 25 }, { account: "1010", credit: 25 }] });
    expect(await journal(db, ok)).toEqual([["1010", 0, 25], ["6130", 25, 0]]);
    await expect(doc(db, { type: "journal", date: "2026-03-05", lines: [{ account: "6130", debit: 25 }, { account: "1010", credit: 20 }] }))
      .rejects.toThrow(/does not balance/);
  });

  it("15 · opening balances: the difference goes to Opening Balance Equity", async () => {
    const id = await doc(db, { type: "opening_balance", date: "2025-12-31", lines: [{ account: "1010", debit: 50000 }, { account: "2000", credit: 12000 }] });
    expect(await journal(db, id)).toEqual([["1010", 50000, 0], ["2000", 0, 12000], ["3900", 0, 38000]]);
  });

  it("16 · bad debt: Dr Bad Debts (project), Cr AR; the invoice is settled", async () => {
    const inv = await invoice(1000);
    const bd = await doc(db, { type: "bad_debt", date: "2026-06-30", contact: client, total: 1080, apply: [{ to: inv, amount: 1080 }] });
    expect(await journal(db, bd)).toEqual([["1100", 0, 1080], ["6210", 1080, 0]]);
    expect(await balance(db, "6210", { project: p1 })).toBe(1080);
    expect(await status(db, inv)).toBe("paid");
  });

  it("17, 18 · external loan and capital-pool contribution go to that person's own sub-account", async () => {
    const lender = await contact(db, "Bank of Friends", ["lender"]);
    const mujahid = (await one<{ id: string }>(db, `select id from contacts where name = 'Mujahid'`)).id;
    const loan = await doc(db, { type: "loan_receipt", date: "2026-01-10", contact: lender, project: p1, bank: "1010", total: 400000 });
    const cap = await doc(db, { type: "capital_contribution", date: "2026-01-10", contact: mujahid, project: p1, bank: "1010", total: 300000 });
    const sub = async (parent: string, who: string) =>
      (await one<{ code: string }>(db, `select code from accounts where parent_id = (select id from accounts where code = $1) and contact_id = $2`, [parent, who])).code;
    expect(await journal(db, loan)).toEqual([["1010", 400000, 0], [await sub("2600", lender), 0, 400000]]);
    expect(await journal(db, cap)).toEqual([["1010", 300000, 0], [await sub("2700", mujahid), 0, 300000]]);
    await expect(doc(db, { type: "loan_receipt", date: "2026-01-10", contact: mujahid, project: p1, bank: "1010", total: 1 }))
      .rejects.toThrow(/from a lender/);
  });

  it("22, 23, 24 · salary paid, pension remitted, staff advance", async () => {
    const emp = (await one<{ id: string }>(db, `select id from employees limit 1`)).id;
    const adv = await doc(db, { type: "staff_advance", date: "2026-03-01", employee: emp, bank: "1010", total: 2000 });
    expect(await journal(db, adv)).toEqual([["1010", 0, 2000], ["1300", 2000, 0]]);
    const sal = await doc(db, { type: "salary_payment", date: "2026-03-31", bank: "1010", lines: [{ employee: emp, amount: 9000 }] });
    expect(await journal(db, sal)).toEqual([["1010", 0, 9000], ["2200", 9000, 0]]);
    const rem = await doc(db, { type: "payroll_remittance", date: "2026-04-10", bank: "1010", lines: [{ account: "2210", amount: 1400 }] });
    expect(await journal(db, rem)).toEqual([["1010", 0, 1400], ["2210", 1400, 0]]);
  });

  it("27, 29 · GST payment and BPT provision", async () => {
    const pay = await doc(db, { type: "gst_payment", date: "2026-04-28", bank: "1010", total: 740 });
    expect(await journal(db, pay)).toEqual([["1010", 0, 740], ["2110", 740, 0]]);
    const bpt = await doc(db, { type: "bpt_provision", date: "2026-12-31", lines: [{ account: "6400", debit: 37500 }, { account: "2300", credit: 37500 }] });
    expect(await journal(db, bpt)).toEqual([["2300", 0, 37500], ["6400", 37500, 0]]);
  });

  it("FX · a USD invoice is booked in MVR at its rate", async () => {
    const id = await invoice(1000, { currency: "USD", fx: 15.42 });
    expect(await journal(db, id)).toEqual([["1100", 16653.6, 0], ["2100", 0, 1233.6], ["4000", 0, 15420]]);
  });
});

describe("post on save, void, delete, locks", () => {
  it("editing re-posts: the journal always reflects the document as it is now", async () => {
    const id = await invoice(1000);
    await db.transaction(async (tx) => {
      await tx.query(`update transaction_lines set rate = 2500 where transaction_id = $1`, [id]);
      await tx.query(`select post_transaction($1)`, [id]);
    });
    expect(await journal(db, id)).toEqual([["1100", 2700, 0], ["2100", 0, 200], ["4000", 0, 2500]]);
  });

  it("void keeps the document and removes its effect; a paid invoice must lose its payment first", async () => {
    const inv = await invoice(1000);
    const pay = await doc(db, { type: "customer_payment", date: "2026-03-20", contact: client, total: 1080, apply: [{ to: inv, amount: 1080 }] });
    await expect(db.query(`select void_transaction($1, 'wrong')`, [inv])).rejects.toThrow(/applied to this document/);
    await db.transaction(async (tx) => { await tx.query(`select void_transaction($1, 'bounced')`, [pay]); });
    expect(await status(db, inv)).toBe("open");
    await db.transaction(async (tx) => { await tx.query(`select void_transaction($1, 'cancelled')`, [inv]); });
    expect(await status(db, inv)).toBe("void");
    expect(await journal(db, inv)).toEqual([]);
    expect((await one<{ n: string }>(db, `select count(*) n from transactions where id = $1`, [inv])).n).toBe(1);
  });

  it("posted documents cannot be deleted; drafts can, and a draft has no journal", async () => {
    const inv = await invoice(1000);
    await expect(db.query(`delete from transactions where id = $1`, [inv])).rejects.toThrow(/void it instead/);
    const draft = await invoice(500, { draft: true });
    expect(await journal(db, draft)).toEqual([]);
    expect(await status(db, draft)).toBe("draft");
    await db.query(`delete from transactions where id = $1`, [draft]);
  });

  it("closing date: nothing on or before it can be created, changed or voided", async () => {
    const inv = await invoice(1000);
    await db.query(`update settings set closing_date = '2026-03-31'`);
    await expect(invoice(1, { date: "2026-03-15" })).rejects.toThrow(/closed up to 31 Mar 2026/);
    await expect(db.query(`select void_transaction($1, 'x')`, [inv])).rejects.toThrow(/closed/);
    await expect(db.query(`update transaction_lines set rate = 5 where transaction_id = $1`, [inv])).rejects.toThrow(/closed/);
    // marking it sent is not a change to the books
    await db.query(`update transactions set sent_at = now() where id = $1`, [inv]);
    expect(await invoice(1, { date: "2026-04-01" })).toBeTruthy();
  });

  it("applications: same contact, right document types, never more than owed", async () => {
    const inv = await invoice(1000);
    const other = await contact(db, "Other Client", ["customer"]);
    await expect(doc(db, { type: "customer_payment", date: "2026-03-20", contact: other, total: 10, apply: [{ to: inv, amount: 10 }] }))
      .rejects.toThrow(/same contact/);
    await expect(doc(db, { type: "customer_payment", date: "2026-03-20", contact: client, total: 5000, apply: [{ to: inv, amount: 5000 }] }))
      .rejects.toThrow(/More is applied/);
    const bill = await doc(db, { type: "bill", date: "2026-03-05", contact: client, lines: [{ account: "5000", amount: 10 }] });
    await expect(doc(db, { type: "customer_payment", date: "2026-03-20", contact: client, total: 10, apply: [{ to: bill, amount: 10 }] }))
      .rejects.toThrow(/cannot be applied/);
  });

  it("statuses are derived: overdue once past due with a balance", async () => {
    const inv = await invoice(1000, { date: "2026-01-10", dueDate: "2026-02-10" });
    expect(await status(db, inv)).toBe("overdue");
    await db.query(`update transactions set sent_at = now() where id = $1`, [inv]);
    expect(await status(db, inv)).toBe("overdue");
  });

  it("a payment split across two projects' invoices carries each project's share", async () => {
    const p2 = await project(db, "P-002", client, 50000);
    const inv = await doc(db, { type: "invoice", date: "2026-03-10", contact: client,
      lines: [{ account: "4000", amount: 3000, project: p1 }, { account: "4000", amount: 1000, project: p2 }] });
    await doc(db, { type: "customer_payment", date: "2026-03-20", contact: client, total: 2000, apply: [{ to: inv, amount: 2000 }] });
    expect(await balance(db, "1100", { project: p1 })).toBe(1500);
    expect(await balance(db, "1100", { project: p2 })).toBe(500);
  });
});
