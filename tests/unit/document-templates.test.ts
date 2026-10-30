import { describe, expect, it } from "vitest";
import { toTemplate } from "@/lib/documents";

const row = (kind: string, header: object = {}, body: object = {}) =>
  ({ id: "t", kind, name: "T", is_default: true, header, body, tail: {} });

describe("document templates", () => {
  it("moves a quotation template saved before the boxed page to it, with its column names", () => {
    const t = toTemplate(row("quotation", { company_name: "Spruce & Co" }, { col_total: "Amount", show_unit: false }));
    expect(t.header.layout).toBe("boxed");
    expect(t.body).toMatchObject({ col_total: "Amount (MVR)", show_unit: true, to_label: "CUSTOMER:" });
    expect(t.tail.show_client_signature).toBe(true);
  });

  it("keeps what a template saved with a layout says", () => {
    const t = toTemplate(row("quotation", { layout: "modern" }, { col_total: "Amount" }));
    expect(t.header.layout).toBe("modern");
    expect(t.body.col_total).toBe("Amount");
  });

  it("leaves invoice templates on the modern page", () => {
    expect(toTemplate(row("invoice")).header.layout).toBe("modern");
  });
});
