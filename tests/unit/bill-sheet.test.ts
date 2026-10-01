import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readBillSheet } from "@/server/project-bills";
import { SHEET_COLUMNS } from "@/lib/bill-import";

const headers = SHEET_COLUMNS.map(([, h]) => h);

describe("reading an uploaded bills sheet", () => {
  it("reads the template's columns, with real dates and numbers as Excel stores them", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Bills");
    ws.addRow(headers);
    ws.addRow(["", new Date(Date.UTC(2026, 8, 1)), "", "Timber Ltd", "1000222GST501", "TL-1", "", "Plywood", 5000, 1234.5, 98.76, "Y", "PO-7"]);
    ws.addRow([]); // a blank row in between is ignored
    ws.addRow(["", "2/9/2026", "", "Corner Shop", "", "", "", "Nails", "5000", "45.50", "", "N", ""]);
    const rows = await readBillSheet(new File([await wb.xlsx.writeBuffer()], "bills.xlsx"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ row: 2, date: "2026-09-01", vendor: "Timber Ltd", account: "5000", amount: "1234.50", gst: "98.76", claimable: "Y", reference: "PO-7" });
    expect(rows[1]).toMatchObject({ row: 4, date: "2/9/2026", amount: "45.50" });
  });

  it("finds columns by their heading even when moved, and reads a CSV", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Whatever");
    ws.addRow(["Vendor", "Amount before GST", "Account code", "Bill date (YYYY-MM-DD)"]);
    ws.addRow(["Timber Ltd", 10, "5000", "2026-09-03"]);
    const rows = await readBillSheet(new File([await wb.xlsx.writeBuffer()], "moved.xlsx"));
    expect(rows[0]).toMatchObject({ vendor: "Timber Ltd", amount: "10", account: "5000", date: "2026-09-03" });

    const csv = `${headers.join(",")}\n,2026-09-04,,Timber Ltd,,,,Glue,5000,12.5,1,Y,\n`;
    const fromCsv = await readBillSheet(new File([csv], "bills.csv"));
    expect(fromCsv[0]).toMatchObject({ vendor: "Timber Ltd", description: "Glue", amount: "12.50" });
  });
});
