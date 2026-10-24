import { describe, expect, it } from "vitest";
import { navPages, placeOf, visibleFor } from "@/lib/nav";

/** The menu: one item per area, the area's other pages as tabs. */
describe("menu", () => {
  it("is short: about a dozen items, every page still reachable", () => {
    const admin = visibleFor("admin", { gstRegistered: true, book: "live" });
    expect(admin.flatMap((g) => g.items).length).toBeLessThanOrEqual(15);
    expect(navPages().length).toBeGreaterThan(25);
  });

  it("puts a page under its area, on the closest tab", () => {
    const groups = visibleFor("admin", { book: "live" });
    expect(placeOf(groups, "/sales/customers/abc")).toMatchObject({ item: { label: "Sales" }, tab: { label: "Customers" } });
    expect(placeOf(groups, "/sales/new")).toMatchObject({ item: { label: "Sales" }, tab: { label: "Sales & invoices" } });
    expect(placeOf(groups, "/quotations/1/edit")).toMatchObject({ item: { label: "Sales" }, tab: { label: "Quotations" } });
    expect(placeOf(groups, "/settings/taxes")).toMatchObject({ item: { label: "Settings" }, tab: { label: "Taxes & rates" } });
    expect(placeOf(groups, "/")).toMatchObject({ item: { label: "Dashboard" }, tab: null });
    expect(placeOf(groups, "/projects/1")).toMatchObject({ item: { label: "Projects" }, tab: null });
    expect(placeOf(groups, "/salesman")).toBeNull();
  });

  it("shows only the tabs a person may see in the book they are in, and opens the first", () => {
    const test = visibleFor("admin", { book: "sandbox" }).flatMap((g) => g.items);
    const sales = test.find((i) => i.label === "Sales")!;
    expect(sales.tabs!.map((t) => t.label)).toEqual(["Sales & invoices", "Customers"]); // quotations are Live only
    expect(test.find((i) => i.label === "Tools")).toMatchObject({ href: "/cut-planner" });
    const viewer = visibleFor("viewer", { book: "live" }).flatMap((g) => g.items);
    expect(viewer.map((i) => i.label)).toEqual(["Dashboard", "Projects", "Tasks & Calendar", "Tools"]);
    expect(viewer.find((i) => i.label === "Tools")!.tabs!.map((t) => t.href)).toEqual(["/cut-planner"]);
  });
});
