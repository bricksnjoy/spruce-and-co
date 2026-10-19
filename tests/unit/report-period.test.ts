import { describe, expect, it } from "vitest";
import { compareRange, fiscalYearStart, presetRange, rangeLabel, readRange } from "@/lib/report-period";

describe("report date ranges", () => {
  const t = "2026-09-30";
  it("presets on a date", () => {
    expect(presetRange("this_month", t)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("this_quarter", t)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(presetRange("last_quarter", "2026-02-10")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(presetRange("this_year", t)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(presetRange("ytd", t)).toEqual({ from: "2026-01-01", to: t });
    expect(presetRange("last_year", t)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("a financial year that starts in July", () => {
    expect(fiscalYearStart("2026-03-15", 7)).toBe("2025-07-01");
    expect(presetRange("this_year", "2026-03-15", 7)).toEqual({ from: "2025-07-01", to: "2026-06-30" });
    expect(presetRange("last_year", "2026-03-15", 7)).toEqual({ from: "2024-07-01", to: "2025-06-30" });
  });

  it("comparison periods", () => {
    expect(compareRange({ from: "2026-07-01", to: "2026-09-30" }, "prior_period")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(compareRange({ from: "2026-03-01", to: "2026-03-31" }, "prior_period")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(compareRange({ from: "2026-01-01", to: "2026-12-31" }, "prior_year")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(compareRange({ from: "2024-02-01", to: "2024-02-29" }, "prior_year")).toEqual({ from: "2023-02-01", to: "2023-02-28" });
    expect(compareRange({ from: "2026-01-01", to: "2026-09-30" }, "prior_year")).toEqual({ from: "2025-01-01", to: "2025-09-30" });
    expect(compareRange({ from: "2026-03-10", to: "2026-03-19" }, "prior_period")).toEqual({ from: "2026-02-28", to: "2026-03-09" });
    expect(compareRange({ from: "2026-03-10", to: "2026-03-19" }, "none")).toBeNull();
  });

  it("reads the query string, falling back to year to date", () => {
    expect(readRange({}, t).range).toEqual({ from: "2026-01-01", to: t });
    expect(readRange({ from: "2026-02-01", to: "2026-02-10" }, t)).toMatchObject({ preset: "custom", range: { from: "2026-02-01", to: "2026-02-10" } });
    expect(readRange({ from: "2026-05-01", to: "2026-02-10", preset: "custom" }, t).range).toEqual({ from: "2026-02-10", to: "2026-05-01" });
    expect(readRange({ preset: "last_month", compare: "prior_year" }, t).prior).toEqual({ from: "2025-08-01", to: "2025-08-31" });
    expect(readRange({ from: "junk" }, t).range.from).toBe("2026-01-01");
  });

  it("labels", () => {
    expect(rangeLabel({ from: "2026-01-01", to: "2026-09-30" })).toBe("Jan–Sep 2026");
    expect(rangeLabel({ from: "2026-03-01", to: "2026-03-31" })).toBe("Mar 2026");
    expect(rangeLabel({ from: "2025-07-01", to: "2026-06-30" })).toBe("Jul 2025 – Jun 2026");
    expect(rangeLabel({ from: "2026-01-01", to: "2026-02-15" })).toBe("1 Jan 2026 – 15 Feb 2026");
  });
});
