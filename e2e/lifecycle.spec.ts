import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { expectRendered, signIn, watchErrors } from "./helpers";

/**
 * §13 end-to-end, through the screens: a project from customer to payouts,
 * and a GST quarter from documents to paying MIRA. Only the employee's project
 * allocation is set up directly; everything else is clicked through.
 */
const DB = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-Atq", "-c", q], { encoding: "utf8" }).trim();
const tag = Date.now().toString(36).slice(-5).toUpperCase();
const digits = String(Date.now()).slice(-5); // TINs are unique, so each run gets its own
const CUSTOMER = `Resort ${tag}`, VENDOR = `Timber ${tag}`, LENDER = `Finance ${tag}`, PROJECT = `Villa ${tag}`;

test.describe.configure({ mode: "serial" });
let projectId = "";
let invoiceNo = "";

async function addContact(page: Page, list: string, button: string, name: string, extra: (p: Page) => Promise<void> = async () => {}) {
  await page.goto(list);
  await page.getByRole("button", { name: button }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await extra(page);
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}
const pick = async (page: Page, label: string | RegExp, option: string | RegExp) => {
  const sel = page.getByLabel(label);
  const value = await sel.locator("option").filter({ hasText: option }).first().getAttribute("value");
  await sel.selectOption(value!);
};

test("a project from customer to payouts, through the screens", async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, "admin");

  // 1. customer, vendor, lender
  await addContact(page, "/sales/customers", "New customer", CUSTOMER, (p) => p.getByLabel("TIN", { exact: true }).fill(`10${digits}1GST501`));
  await addContact(page, "/expenses/vendors", "New vendor", VENDOR, async (p) => {
    await p.getByLabel("TIN", { exact: true }).fill(`10${digits}2GST501`);
    await p.locator('input[name="gst_registered"]').check();
  });
  await addContact(page, "/expenses/vendors", "New vendor", LENDER, async (p) => {
    await p.locator('input[name="kind_lender"]').check();
  });

  // 2. the project
  await page.goto("/projects/new");
  await page.getByLabel("Project name").fill(PROJECT);
  await pick(page, "Customer", CUSTOMER);
  await page.getByLabel("Project value (MVR)").fill("550000");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  projectId = page.url().match(/projects\/([0-9a-f-]{36})/)![1];
  await expectRendered(page);

  // 3. a progress invoice with GST
  await page.goto(`/sales/new?type=invoice&project=${projectId}`);
  await pick(page, "Customer", CUSTOMER);
  await page.getByLabel("Line 1 description").fill("Progress claim 1");
  await page.getByLabel("Line 1 amount").fill("300000");
  await pick(page, "Line 1 GST", /%/);
  await page.getByRole("button", { name: "Save invoice" }).click();
  await page.waitForURL(/\/sales\/[0-9a-f-]{36}$/);
  const invoiceId = page.url().split("/").pop()!;
  invoiceNo = sql(`select number from transactions where id = '${invoiceId}'`);
  await expect(page.locator("main")).toContainText(invoiceNo);
  expect(invoiceNo).not.toBe("");

  // 4. a bill with claimable GST, charged to the project
  await page.goto(`/expenses/new?type=bill&project=${projectId}`);
  await pick(page, /^Vendor/, VENDOR);
  await page.getByLabel("Tax invoice no.").fill(`TI-${tag}`);
  await pick(page, "Line 1 account", /5000/);
  await page.getByLabel("Line 1 amount before GST").fill("150000");
  await page.getByLabel("Line 1 GST").fill("12000");
  await page.getByRole("button", { name: "Save bill" }).click();
  await page.waitForURL(/\/expenses\/[0-9a-f-]{36}$/);

  // 5. payroll: a site employee allocated to the project
  const emp = sql(`insert into employees (name, basic_salary, nationality_type, department, wht_applicable) values ('Site lead ${tag}', 12000, 'expatriate', 'site', false) returning id`);
  sql(`insert into employee_allocations (employee_id, project_id, percent, effective_from) values ('${emp}', '${projectId}', 100, '2020-01-01')`);
  sql(`delete from payroll_runs where book = 'live' and status = 'draft'`);
  await page.goto("/payroll");
  const month = sql(`select to_char(coalesce(max(period_month) + interval '1 month', date_trunc('month', current_date)), 'YYYY-MM') from payroll_runs where book = 'live'`);
  await page.getByLabel("Month").fill(month);
  await page.getByRole("button", { name: "Start payroll run" }).click();
  await page.waitForURL(/\/payroll\/runs\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Approve and post" }).click();
  await pick(page, "Pay from", /1010/);
  await page.getByRole("button", { name: "Pay net salaries" }).click();
  await expect(page.getByText("Paid.")).toBeVisible();

  // 6. financing: a Capital Pool contribution and an external loan
  await page.goto(`/projects/${projectId}?tab=financing`);
  await pick(page, "From", "Capital Pool member");
  await pick(page, "Member", "Mujahid");
  await pick(page, "Paid into", /1010/);
  await page.getByLabel("Amount (MVR)").fill("200000");
  await page.getByRole("button", { name: "Record financing" }).click();
  await expect(page.getByText("Recorded.")).toBeVisible();
  await page.waitForLoadState("networkidle"); // let the refresh after saving land before the next entry
  await pick(page, "From", "External lender");
  await pick(page, "Lender", LENDER);
  await pick(page, "Paid into", /1010/);
  await page.getByLabel("Amount (MVR)").fill("100000");
  await page.getByRole("button", { name: "Record financing" }).click();
  await expect(page.getByRole("cell", { name: LENDER }).first()).toBeVisible();

  // 7. a partial payment
  const invTotal = Number(sql(`select total from document_balances_v where number = '${invoiceNo}' and book = 'live'`));
  await page.goto("/sales/payments/new");
  await pick(page, "Customer", CUSTOMER);
  await page.getByLabel("Amount received").fill("100000");
  await pick(page, "Paid into", /1010/);
  await page.getByLabel(`Apply to ${invoiceNo}`).fill("100000");
  await page.getByRole("button", { name: "Save payment" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/new"));

  // 8. complete: the split is posted and payouts are blocked
  await page.goto(`/projects/${projectId}?tab=split`);
  await expect(page.getByText("Split preview")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Complete and post split" }).click();
  await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible(); // only shown once the split is posted
  await page.goto(`/projects/${projectId}?tab=payouts`);
  await expect(page.getByText(/Payouts are blocked: The client still owes/)).toBeVisible();

  // 9. the final payment releases them
  await page.goto("/sales/payments/new");
  await pick(page, "Customer", CUSTOMER);
  const rest = (invTotal - 100000).toFixed(2);
  await page.getByLabel("Amount received").fill(rest);
  await pick(page, "Paid into", /1010/);
  await page.getByLabel(`Apply to ${invoiceNo}`).fill(rest);
  await page.getByRole("button", { name: "Save payment" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/new"));
  await page.goto(`/projects/${projectId}?tab=payouts`);
  await expect(page.getByText("Payouts are released")).toBeVisible();

  // 10. pay out all three components to Mujahid
  const mujahid = sql(`select id from contacts where name = 'Mujahid' and book = 'live' limit 1`);
  await page.goto(`/partners/${mujahid}`);
  await expect(page.getByRole("heading", { name: "Pay out" })).toBeVisible();
  const all = await page.getByRole("button", { name: "All", exact: true }).all();
  expect(all.length).toBeGreaterThanOrEqual(3); // principal, financing return, profit share
  for (const b of all) await b.click();
  await pick(page, "Paid from", /1010/);
  await page.getByRole("button", { name: /Approve and pay/ }).click();
  // the payout shows in the history as paid (the Pay out card goes once nothing is owed)
  const code = sql(`select code from projects where id = '${projectId}'`);
  await expect(page.getByRole("row").filter({ hasText: `${code} · Profit share` }).getByText("paid", { exact: true })).toBeVisible();
  const owed = sql(`select coalesce(sum(outstanding), 0) from partner_statement_v where contact_id = '${mujahid}' and project_id = '${projectId}'`);
  expect(Number(owed)).toBe(0);

  // 11. every statement ties out
  await page.goto("/reports/balance-sheet");
  const cell = async (label: string) => (await page.getByRole("row", { name: new RegExp(`^${label}`) }).locator("td").nth(1).innerText()).replace(/[^0-9.()-]/g, "");
  expect(await cell("Total assets")).toBe(await cell("Total liabilities and equity"));
  await page.goto("/accounting/health");
  expect(sql(`select count(*) filter (where not ok) from health_check('live')`)).toBe("0");
  await expectRendered(page);
  w.assertNone();
});

test("a GST quarter: file, settle, pay MIRA, and it is locked", async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, "admin");
  await page.goto("/taxes");
  await page.locator('main a[href^="/taxes/gst/"]').first().click();
  await page.waitForURL(/\/taxes\/gst\/[0-9a-f-]{36}/);
  const period = page.url().split("/").pop()!;
  // file in order: earlier open returns first
  const earlier = sql(`select count(*) from tax_periods where book = 'live' and status = 'open' and start_date < (select start_date from tax_periods where id = '${period}')`);
  test.skip(earlier !== "0", "an earlier return is still open in this database");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "File return" }).click();
  await expect(page.getByText(/figures as filed/i)).toBeVisible();
  await pick(page, "Paid from", /1010/);
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect.poll(() => sql(`select status from tax_periods where id = '${period}'`)).toMatch(/paid|filed/);
  expect(sql(`select settlement_transaction_id is not null from tax_periods where id = '${period}'`)).toBe("t");
  await page.goto("/reports/gst-control");
  await expectRendered(page);
  expect(sql(`select count(*) filter (where not ok) from health_check('live')`)).toBe("0");
  w.assertNone();
});
