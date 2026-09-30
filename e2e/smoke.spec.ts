import { test, expect } from "@playwright/test";
import { expectRendered, signIn, watchErrors } from "./helpers";

/** §14: no dead routes or placeholder pages — every rebuilt screen opens cleanly for an admin. */
const ROUTES = [
  "/", "/projects", "/projects/new", "/sales", "/sales/customers", "/sales/new?type=invoice", "/sales/payments/new", "/sales/deposits/new", "/sales/advances",
  "/expenses", "/expenses/vendors", "/expenses/new?type=bill", "/expenses/pay", "/payroll", "/payroll/employees", "/payroll/remittances",
  "/banking", "/banking/rules", "/taxes", "/partners", "/partners/distributions", "/reports", "/accounting/chart", "/accounting/health",
  "/accounting/journal", "/accounting/journal/new", "/accounting/journal/new?type=opening_balance", "/search?q=INV",
  "/settings/company", "/settings/accounting", "/settings/taxes", "/settings/numbering", "/settings/currencies", "/settings/profit-share",
];

test("every rebuilt screen opens without errors", async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, "admin");
  for (const r of ROUTES) {
    const res = await page.goto(r);
    expect(res?.status(), r).toBeLessThan(400);
    await expectRendered(page);
  }
  w.assertNone();
});

test("every report runs, exports and prints", async ({ page, request }) => {
  const w = watchErrors(page);
  await signIn(page, "admin");
  await page.goto("/reports");
  await expect(page.getByRole("link", { name: "Statement of Profit or Loss" })).toBeVisible();
  const links = await page.locator('main a[href^="/reports/"]:not([href*="/export"])').evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!))]);
  expect(links.length).toBeGreaterThan(30);
  for (const href of links) {
    const res = await page.goto(href);
    expect(res?.status(), href).toBeLessThan(400);
    await expectRendered(page);
    await expect(page.locator("main"), href).not.toContainText("could not be run");
  }
  // exports and the print view go through the same builder
  const cookies = await page.context().cookies();
  const headers = { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
  for (const f of ["csv", "xlsx"]) {
    const r = await request.get(`/reports/profit-loss/export?format=${f}`, { headers });
    expect(r.status(), f).toBe(200);
  }
  await page.goto("/print/reports/balance-sheet");
  await expectRendered(page);
  await page.goto("/print/reports/year-end?preset=ytd");
  await expectRendered(page);
  w.assertNone();
});

test("the viewer cannot see payroll or change the books", async ({ page }) => {
  await signIn(page, "viewer");
  await page.goto("/reports/payroll-summary");
  await expect(page.locator("main")).toContainText(/payroll permission|staff who work with the books/);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "+ New" })).toHaveCount(0);
});
