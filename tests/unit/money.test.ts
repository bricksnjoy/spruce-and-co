import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { dbToLaari, laariToDb, moneyToDb, percentToDb, toLaari, withRunning } from "@/lib/money";

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
    expect(worksInTest("/")).toBe(false);
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
