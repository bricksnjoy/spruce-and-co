import { describe, expect, it } from "vitest";
import { checkRows, closestShops, readDate, type Lookups, type RawRow } from "@/lib/bill-import";

const look: Lookups = {
  vendors: [
    { id: "v1", name: "Timber Ltd", tin: "1000222GST501", gst_registered: true },
    { id: "v2", name: "Corner Shop", tin: null, gst_registered: false },
    { id: "v3", name: "Sunrise Hardware", tin: "1000333GST501", gst_registered: true },
  ],
  accounts: [{ id: "a5000", code: "5000", name: "Materials" }, { id: "a5050", code: "5050", name: "Site Expenses" }],
  saved: [{ id: "bill-9", contact_id: "v1", tax_invoice_no: "TL-9", number: "BILL/26/009" }],
};
const row = (n: number, r: Partial<RawRow>): RawRow => ({ row: n, date: "2026-09-01", shop: "Timber Ltd", category: "Materials", amount: "1000", ...r });

describe("bill sheet upload", () => {
  it("reads dates typed the usual ways", () => {
    expect(readDate("2026-09-01")).toBe("2026-09-01");
    expect(readDate("1/9/2026")).toBe("2026-09-01");
    expect(readDate("2026-09-01T00:00:00.000Z")).toBe("2026-09-01");
    expect(readDate("31/2/2026")).toBeNull();
    expect(readDate("soon")).toBeNull();
  });

  it("takes amount less discount plus GST, the category's account, and groups one receipt's rows into one bill", () => {
    const { rows, bills } = checkRows([
      row(2, { invoice_no: "TL-1", discount: "100", gst: "72", total: "972" }),
      row(3, { invoice_no: "TL-1", amount: "500", category: "Site Expenses" }),
      row(4, { shop: "corner shop", amount: "75.50", category: "" }),
    ], look);
    expect(rows.map((r) => r.status)).toEqual(["new", "new", "new"]);
    expect(rows[0]).toMatchObject({ net: "900.00", total: "972.00", account_id: "a5000", claimable: true });
    expect(rows[2]).toMatchObject({ shop: "Corner Shop", account_id: "a5000" });
    expect(bills).toHaveLength(2);
    expect(bills[0].lines).toEqual([
      { description: "Materials, less 100.00 discount", account_id: "a5000", amount: "900.00", tax_amount: "72.00", gst_claimable: true },
      { description: null, account_id: "a5050", amount: "500.00", tax_amount: "0.00", gst_claimable: false },
    ]);
    expect(bills[0]).toMatchObject({ total: "1472.00", invoice_no: "TL-1", invoice_date: "2026-09-01" });
    expect(bills[1].total).toBe("75.50");
  });

  it("claims GST only with an invoice no. from a GST-registered shop with a TIN; otherwise it is cost, with a note", () => {
    const { rows } = checkRows([
      row(2, { gst: "80" }),
      row(3, { shop: "Corner Shop", invoice_no: "C-1", gst: "6" }),
      row(4, { invoice_no: "TL-2", gst: "80" }),
    ], look);
    expect(rows.map((r) => r.status)).toEqual(["new", "new", "new"]);
    expect(rows.map((r) => r.claimable)).toEqual([false, false, true]);
    expect(rows[0].note).toMatch(/no invoice no/);
    expect(rows[1].note).toMatch(/not marked GST-registered/);
  });

  it("flags what cannot be saved, row by row", () => {
    const { rows, bills } = checkRows([
      row(2, { date: "next week" }),
      row(3, { category: "Snacks" }),
      row(4, { amount: "-5" }),
      row(5, { discount: "1000" }),
      row(6, { gst: "80", total: "1000" }),
      row(7, { shop: "" }),
    ], look);
    expect(rows.every((r) => r.status === "error")).toBe(true);
    expect(rows[1].errors.join()).toMatch(/No category "Snacks"/);
    expect(rows[3].errors.join()).toMatch(/Discount/);
    expect(rows[4].errors.join()).toMatch(/Total is 1000.00 but amount − discount \+ GST is 1080.00/);
    expect(bills).toHaveLength(0);
  });

  it("holds a shop not on file until it is matched (a spelling slip) or confirmed as new", () => {
    const sheet = [row(2, { shop: "Sunrise Hardwear" }), row(3, { shop: "Sunrise Hardwear", amount: "20" }), row(4, { shop: "Blue Lagoon Traders" })];
    const first = checkRows(sheet, look);
    expect(first.rows.map((r) => r.status)).toEqual(["error", "error", "error"]);
    expect(first.unknownShops.map((u) => [u.name, u.rows])).toEqual([["Sunrise Hardwear", [2, 3]], ["Blue Lagoon Traders", [4]]]);
    expect(first.unknownShops[0].suggestions[0]).toEqual({ id: "v3", name: "Sunrise Hardware" });

    const fixed = checkRows(sheet, look, { "sunrise hardwear": "v3", "blue lagoon traders": "new" });
    expect(fixed.rows.map((r) => r.status)).toEqual(["new", "new", "new"]);
    expect(fixed.rows[0]).toMatchObject({ shop: "Sunrise Hardware", vendor_id: "v3", typed_shop: "Sunrise Hardwear" });
    expect(fixed.rows[2]).toMatchObject({ shop: "Blue Lagoon Traders", vendor_id: null, new_vendor: true });
    expect(fixed.bills.map((b) => b.vendor)).toEqual(["Sunrise Hardware", "Sunrise Hardware", "Blue Lagoon Traders"]);
  });

  it("suggests the closest shop names", () => {
    expect(closestShops("timber", look.vendors).map((x) => x.name)).toEqual(["Timber Ltd"]);
    expect(closestShops("Cornr Shop", look.vendors)[0].name).toBe("Corner Shop");
    expect(closestShops("Maldives Ports", look.vendors)).toEqual([]);
  });

  it("skips rows already saved: the same shop + invoice no., or the same shop, date, category and amount", () => {
    const { rows, bills } = checkRows([
      row(2, { invoice_no: "tl-9" }),
      row(3, { amount: "1100", discount: "100" }),
      row(4, { amount: "40" }),
    ], { ...look, savedLines: [{ contact_id: "v1", date: "2026-09-01", account_id: "a5000", amount: "1000.00", number: "BILL/26/010" }] });
    expect(rows.map((r) => r.status)).toEqual(["saved", "saved", "new"]);
    expect(rows[0].note).toMatch(/BILL\/26\/009/);
    expect(rows[1].note).toMatch(/BILL\/26\/010/);
    expect(bills).toHaveLength(1);
  });

  it("does not let two rows of one invoice disagree on the date", () => {
    const { rows } = checkRows([row(2, { invoice_no: "TL-5" }), row(3, { invoice_no: "TL-5", date: "2026-09-02" })], look);
    expect(rows[1].status).toBe("error");
    expect(rows[1].errors.join()).toMatch(/different date/);
  });
});
