import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MonthCalendar, shiftMonth, type CalendarItem } from "@/app/(app)/tasks/month-calendar";

describe("the month calendar", () => {
  it("moves a month either way, across the year", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("lists each day's items, and shows the next month's first days in the last week", () => {
    const items = new Map<string, CalendarItem[]>([
      ["2026-10-15", [{ kind: "task", label: "Order glass", href: null }]],
      ["2026-11-04", [{ kind: "bid", label: "Submission · Call centre", href: "/bids/x" }]],
    ]);
    const html = renderToStaticMarkup(createElement(MonthCalendar, { month: "2026-10", today: "2026-10-31", items }));
    expect(html).toContain("October 2026");
    expect(html).toContain("Order glass");
    expect(html).toContain("Submission · Call centre");
    expect(html).toContain('href="/tasks?month=2026-11"');
  });
});
