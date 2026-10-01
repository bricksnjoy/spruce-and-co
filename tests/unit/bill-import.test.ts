import { describe, expect, it } from "vitest";
import { checkRows, readDate, type Lookups, type RawRow } from "@/lib/bill-import";

const look: Lookups = {
  vendors: [
    { id: "v1", name: "Timber Ltd", tin: "1000222GST501", gst_registered: true },
    { id: "v2", name: "Corner Shop", tin: null, gst_registered: false },
  ],
  accounts: [{ id: "a5000", code: "5000", name: "Materials" }, { id: "a5050", code: "5050", name: "Site Expenses" }],
  projectBillIds: new Set(["bill-1"]),
  saved: [{ id: "bill-9", contact_id: "v1", tax_invoice_no: "TL-9", number: "BILL/26/009" }],
};
const row = (n: number, r: Partial<RawRow>): RawRow => ({ row: n, date: "2026-09-01", vendor: "Timber Ltd", account: "5000", amount: "1000", ...r });

describe("bill sheet upload", () => {
  it("reads dates typed the usual ways", () => {
    expect(readDate("2026-09-01")).toBe("2026-09-01");
    expect(readDate("1/9/2026")).toBe("2026-09-01");
    expect(readDate("2026-09-01T00:00:00.000Z")).toBe("2026-09-01");
    expect(readDate("31/2/2026")).toBeNull();
    expect(readDate("soon")).toBeNull();
  });

  it("groups rows with the same vendor and invoice number into one bill, others into their own", () => {
    const { rows, bills } = checkRows([
      row(2, { invoice_no: "TL-1", gst: "80", claimable: "Y", description: "Plywood" }),
      row(3, { invoice_no: "TL-1", amount: "500", account: "Site Expenses", description: "Delivery" }),
      row(4, { vendor: "Corner Shop", amount: "75.50" }),
    ], look);
    expect(rows.map((r) => r.status)).toEqual(["new", "new", "new"]);
    expect(bills).toHaveLength(2);
    expect(bills[0].lines).toHaveLength(2);
    expect(bills[0].total).toBe("1580.00");
    expect(bills[0].invoice_date).toBe("2026-09-01");
    expect(bills[1].total).toBe("75.50");
  });

  it("flags what cannot be saved, row by row", () => {
    const { rows, bills } = checkRows([
      row(2, { date: "next week" }),
      row(3, { account: "9999" }),
      row(4, { amount: "-5" }),
      row(5, { vendor: "Corner Shop", gst: "6", claimable: "Y" }),
      row(6, { invoice_no: "", gst: "80", claimable: "Y" }),
      row(7, { due_date: "2026-08-01" }),
    ], look);
    expect(rows.every((r) => r.status === "error")).toBe(true);
    expect(rows[3].errors.join()).toMatch(/TIN|not marked GST-registered/);
    expect(rows[4].errors.join()).toMatch(/supplier invoice no/);
    expect(bills).toHaveLength(0);
  });

  it("skips rows already saved: an ID from the download, or a vendor + invoice number already on a bill", () => {
    const { rows, bills } = checkRows([
      row(2, { id: "bill-1" }),
      row(3, { invoice_no: "tl-9" }),
      row(4, { id: "someone-elses" }),
      row(5, { vendor: "Brand New Traders", vendor_tin: "1000777GST501" }),
    ], look);
    expect(rows.map((r) => r.status)).toEqual(["saved", "saved", "error", "new"]);
    expect(rows[1].note).toMatch(/BILL\/26\/009/);
    expect(rows[3].new_vendor).toBe(true);
    expect(bills).toHaveLength(1);
  });

  it("a row with no invoice number is recognised by vendor, date, account, amount and description", () => {
    const withLines: Lookups = { ...look, savedLines: [{ contact_id: "v2", date: "2026-09-01", account_id: "a5000", amount: "75.5", description: "Nails", number: "BILL/26/010" }] };
    const { rows, bills } = checkRows([
      row(2, { vendor: "Corner Shop", amount: "75.50", description: "nails" }),
      row(3, { vendor: "Corner Shop", amount: "75.50", description: "Screws" }),
    ], withLines);
    expect(rows.map((r) => r.status)).toEqual(["saved", "new"]);
    expect(rows[0].note).toMatch(/BILL\/26\/010/);
    expect(bills).toHaveLength(1);
  });
});
