import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesSheet } from "@/components/sales/sales-sheet";
import type { Company } from "@/components/sales/ledger-sheet";

/** The printed page and the live preview beside the form are the same sheet. */
const company: Company = {
  legal_name: "Spruce & Co Pvt Ltd", trade_name: null, tin: "1234567GST001", gst_registered: true,
  taxable_activity_no: "1234567GST001", address: "Male", phone: null, email: null, bank_details: "BML 7730000012345",
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("sales sheet", () => {
  const sheet = (over: Partial<Parameters<typeof SalesSheet>[0]> = {}) => text(renderToStaticMarkup(createElement(SalesSheet, {
    type: "invoice", company, number: null,
    customer: { name: "Walkthrough Resort", company_name: null, address: "Hulhumale", tin: "999", gst_registered: false, taxable_activity_no: null },
    date: "2026-10-20", due: "2026-11-19", projectCode: "SC-01", reference: "SC-QT/26/03",
    lines: [
      { description: "Kitchen cabinets", qty: 2, rate: 150000n, amount: 300000n, tax: 24000n, taxName: "Standard" },
      { description: "Installation (75%)", qty: null, rate: null, amount: 75050n, tax: 6004n, taxName: "Standard" },
    ],
    currency: "MVR", memo: "Thank you", signer: { name: "Mujahid", title: "Director", signatureUrl: null, stampUrl: null },
    ...over,
  })));

  it("is laid out as the paper invoice: numbers, headings, lines, totals in words", () => {
    const t = sheet({
      agrNo: "AGR-7", poNo: "WOC-2026-00372",
      lines: [
        { itemNo: "A", description: "CIVIL WORKS", heading: true, qty: null, rate: null, amount: 0n, tax: 0n, taxName: "" },
        { itemNo: "1.1", description: "Kitchen cabinets", unit: "nos", qty: 2, rate: 150000n, amount: 300000n, tax: 24000n, taxName: "Standard" },
        { description: "Installation (75%)", qty: null, rate: null, amount: 75050n, tax: 6004n, taxName: "Standard" },
      ],
    });
    expect(t).toContain("TAX INVOICE");
    expect(t).toContain("TIN: 1234567GST001");
    expect(t).toContain("Customer: Walkthrough Resort");
    expect(t).toContain("Date: 20 October 2026");
    expect(t).toContain("Quotation No: SC-QT/26/03");
    expect(t).toContain("AGR No: AGR-7");
    expect(t).toContain("PO No: WOC-2026-00372");
    expect(t).toContain("A CIVIL WORKS");
    expect(t).toContain("1.1 Kitchen cabinets 2 nos 1,500.00 3,000.00");
    expect(t).toContain("2 Installation (75%)");
    expect(t).toContain("Sub Total 3,750.50");
    expect(t).toContain("Less Advance Payment");
    expect(t).toContain("Less Retention Payment");
    expect(t).toContain("Taxable Amount 3,750.50");
    expect(t).toContain("GST 8% 300.04");
    expect(t).toContain("Grand Total: Four Thousand Fifty Rufiyaa Fifty Four Laari 4,050.54");
    expect(t).toContain("Invoice Received by:");
    expect(t).toContain("Payment Received by:");
    expect(t).toContain("Mujahid");
  });

  it("prints the template's terms, else where to pay", () => {
    expect(sheet()).toContain("All transfers should be made to BML 7730000012345");
    const t = sheet({ terms: "This invoice should be settled within 28 days.\nNo Cash Payments" });
    expect(t).toContain("1- This invoice should be settled within 28 days.");
    expect(t).toContain("2- No Cash Payments");
  });

  it("is a plain invoice before GST registration, and shows what is still owed once part paid", () => {
    const t = sheet({ company: { ...company, gst_registered: false }, paid: 100000n, balance: 305054n });
    expect(t).not.toContain("TAX INVOICE");
    expect(t).toContain("INVOICE");
    expect(t).toContain("Balance Due 3,050.54");
  });

  it("asks for no payment on a credit note", () => {
    const t = sheet({ type: "credit_note", due: null });
    expect(t).toContain("CREDIT NOTE");
    expect(t).toContain("Credit to:");
    expect(t).not.toContain("Less Retention Payment");
    expect(t).not.toContain("Payment Received by");
  });
});
