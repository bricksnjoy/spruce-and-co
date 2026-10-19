import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { dbToLaari, laariToDb, moneyToDb, percentToDb, toLaari, withRunning } from "@/lib/money";
import { periodFor, periodLabel, scheduleCsv } from "@/lib/gst";

describe("money typed into forms", () => {
  it("reads amounts as whole laari, never as floats", () => {
    expect(toLaari("1,250.5")).toBe(125050n);
    expect(toLaari("MVR 0.1")).toBe(10n);
    expect(toLaari("-3.07")).toBe(-307n);
    expect(toLaari("12.345")).toBeNull();
    expect(toLaari("abc")).toBeNull();
    expect(toLaari("")).toBeNull();
    // the float trap: 0.1 + 0.2 is exact in laari
    expect(toLaari("0.1")! + toLaari("0.2")!).toBe(toLaari("0.3"));
  });

  it("round-trips through the database's form", () => {
    fc.assert(fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), (v) => toLaari(laariToDb(v)) === v));
    expect(moneyToDb("1000")).toBe("1000.00");
    expect(moneyToDb("-0.5")).toBe("-0.50");
  });

  it("accepts percentages up to 100 with four decimals", () => {
    expect(percentToDb("8")).toBe("8");
    expect(percentToDb("5.5%")).toBe("5.5");
    expect(percentToDb("100")).toBe("100");
    expect(percentToDb("100.01")).toBeNull();
    expect(percentToDb("7.12345")).toBeNull();
    expect(percentToDb("-1")).toBeNull();
  });

  it("reads database amounts exactly and keeps a running balance", () => {
    expect(dbToLaari(1080)).toBe(108000n);
    expect(dbToLaari("0.07")).toBe(7n);
    expect(dbToLaari(0.29)).toBe(29n);   // 0.29 * 100 is 28.999… as a float
    const rows = withRunning([{ home_debit: 100.1, home_credit: 0 }, { home_debit: 0, home_credit: "0.2" }], 1n);
    expect(rows.map((r) => r.running)).toEqual([10010n, 9990n]);
  });
});

import { worksInTest } from "@/lib/books";
describe("which screens work in the Test book", () => {
  it("allows the rebuilt screens and keeps the old ones Live only", () => {
    expect(worksInTest("/projects")).toBe(true);
    expect(worksInTest("/projects/abc")).toBe(true);
    expect(worksInTest("/projects/abc/legacy")).toBe(false);
    expect(worksInTest("/sales/customers/1")).toBe(true);
    expect(worksInTest("/quotations")).toBe(false);
    // the dashboard reads the new ledger; "/" must not open every route
    expect(worksInTest("/")).toBe(true);
    expect(worksInTest("/capital-pool")).toBe(false);
    expect(worksInTest("/projectsX")).toBe(false);
  });
});

import { percentOf } from "@/lib/money";
describe("a percentage of an amount", () => {
  it("rounds to the laari, half away from zero", () => {
    expect(percentOf(12000000n, "25")).toBe(3000000n);
    expect(percentOf(100n, "33.3333")).toBe(33n);
    expect(percentOf(1n, "50")).toBe(1n);          // 0.5 laari rounds up
    expect(percentOf(-1n, "50")).toBe(-1n);
    expect(percentOf(999n, "8")).toBe(80n);        // 79.92
    expect(percentOf(5n, "abc")).toBe(0n);
  });
});

import { qtyTimesRate } from "@/lib/money";
describe("quantity × rate", () => {
  it("matches the database's round(qty * rate, 2)", () => {
    expect(qtyTimesRate("3", "12.50")).toBe(3750n);
    expect(qtyTimesRate("2.5", "0.333")).toBe(83n);        // 0.8325 → 0.83
    expect(qtyTimesRate("1.5", "0.0033")).toBe(0n);        // 0.00495 → 0.00
    expect(qtyTimesRate("1", "0.005")).toBe(1n);           // 0.005 → 0.01 (half away from zero)
    expect(qtyTimesRate("x", "1")).toBeNull();
  });
});

import { ruleFor, type BankRule } from "@/lib/bank-rules";
describe("bank rules on screen", () => {
  const r = (x: Partial<BankRule>): BankRule => ({ id: x.name ?? "r", name: "r", priority: 100, contains: null, direction: "any", min_amount: null, max_amount: null,
    account_id: "a", contact_id: null, project_id: null, active: true, created_at: "2026-01-01", ...x });
  it("picks the first fitting rule by priority, like the database", () => {
    const rules = [r({ name: "Phone", contains: "dhiraagu", direction: "out" }), r({ name: "Any out", direction: "out", priority: 200 }),
      r({ name: "Big in", direction: "in", min_amount: 1000 }), r({ name: "Off", active: false, priority: 1 })];
    expect(ruleFor(rules, { description: "DHIRAAGU BILL", amount: "-450.00" })?.name).toBe("Phone");
    expect(ruleFor(rules, { description: "FEE", amount: -5 })?.name).toBe("Any out");
    expect(ruleFor(rules, { description: "TRF", amount: "999.99" })).toBeUndefined();
    expect(ruleFor(rules, { description: "TRF", amount: "1000.00" })?.name).toBe("Big in");
  });
});


describe("GST periods (lib/gst)", () => {
  it("matches the database's quarters and due dates", () => {
    expect(periodFor("2026-02-15", 3, 28)).toEqual({ start: "2026-01-01", end: "2026-03-31", due: "2026-04-28" });
    expect(periodFor("2026-11-30", 3, 28)).toEqual({ start: "2026-10-01", end: "2026-12-31", due: "2027-01-28" });
    expect(periodFor("2028-02-10", 1, 20)).toEqual({ start: "2028-02-01", end: "2028-02-29", due: "2028-03-20" });
  });
  it("labels quarters and months", () => {
    expect(periodLabel("2026-04-01", "2026-06-30")).toBe("Q2 2026");
    expect(periodLabel("2026-02-01", "2026-02-28")).toBe("Feb 2026");
  });
  it("writes a schedule as CSV, quoting where needed", () => {
    const csv = scheduleCsv([{ side: "input", transaction_id: "x", date: "2026-02-10", type: "bill", number: null, contact_name: "Shop, Ltd",
      tin: "100", tax_invoice_no: "TI-1", tax_invoice_date: "2026-02-10", customs_ref: null, taxable: "2000.00", gst: "160.00", late: true, correction: false }], "input");
    expect(csv.split("\r\n")[1]).toBe('2026-02-10,bill,,"Shop, Ltd",100,TI-1,2026-02-10,,2000.00,160.00,"Dated in an earlier, filed period"');
  });
});
