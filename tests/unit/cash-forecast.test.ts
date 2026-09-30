import { describe, expect, it } from "vitest";
import { forecast, monthlyOn, weekStart } from "@/lib/cash-forecast";

describe("12-week cash forecast", () => {
  it("weeks start on Monday", () => {
    expect(weekStart("2026-09-30")).toBe("2026-09-28"); // a Wednesday
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // Sunday
  });

  it("places flows in their week; overdue and undated land in week 1; beyond 12 weeks is left out", () => {
    const w = forecast("2026-09-30", 100000n,
      [{ date: "2026-08-01", amount: 5000n, kind: "customers" }, { date: "2026-10-07", amount: 20000n, kind: "customers" }, { date: "2027-06-01", amount: 99n, kind: "customers" }],
      [{ date: null, amount: 3000n, kind: "payouts" }, { date: "2026-10-28", amount: 50000n, kind: "payroll" }, { date: "2026-10-06", amount: 1000n, kind: "bills" }]);
    expect(w).toHaveLength(12);
    expect([w[0].cashIn, w[0].cashOut, w[0].closing]).toEqual([5000n, 3000n, 102000n]);
    expect([w[1].start, w[1].cashIn, w[1].cashOut]).toEqual(["2026-10-05", 20000n, 1000n]);
    expect(w[4].byKind.payroll).toBe(-50000n);
    expect(w[11].closing).toBe(100000n + 25000n - 54000n);
  });

  it("payroll repeats monthly on its day, clamped to short months", () => {
    expect(monthlyOn("2026-01-15", 31, 10n, "payroll", 3).map((f) => f.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(monthlyOn("2026-01-29", 28, 10n, "payroll", 2).map((f) => f.date)).toEqual(["2026-02-28"]);
  });
});
