import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { signIn, watchErrors } from "./helpers";

/** Lenders: their own page, adding one there or from a project's Financing tab, and a loan showing on every screen. */
const DB = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-Atq", "-c", q], { encoding: "utf8" }).trim();
const tag = Date.now().toString(36).slice(-5).toUpperCase();
const pick = async (page: Page, label: string | RegExp, option: string | RegExp) => {
  const sel = page.getByLabel(label, { exact: true });
  const value = await sel.locator("option").filter({ hasText: option }).first().getAttribute("value");
  await sel.selectOption(value!);
};

test("lenders: add one, record a loan from their page, add another from the project", async ({ page }) => {
  const w = watchErrors(page);
  const project = sql(`insert into projects (code, name, contract_value, status, start_date) values ('LN-${tag}', 'Villa ${tag}', 100000, 'in_progress', current_date) returning id`);
  await signIn(page, "admin");

  // the menu has Lenders; New lender adds one and opens their page
  await page.goto("/");
  await page.getByRole("link", { name: "Lenders", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Lenders", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "New lender" }).click();
  await expect(page.getByLabel("Lender", { exact: true })).toBeChecked();
  await page.getByLabel("Name", { exact: true }).fill(`Bank ${tag}`);
  await page.getByLabel("Phone").fill("7771234");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("heading", { name: `Bank ${tag}`, level: 1 })).toBeVisible();
  await expect(page.getByText("Nothing received from them yet.")).toBeVisible();

  // Record a loan: the project's Financing tab opens with the lender picked
  await pick(page, "Project", `LN-${tag}`);
  await page.getByRole("button", { name: "Record a loan" }).click();
  await page.waitForURL(/tab=financing/);
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("loan_receipt");
  await expect(page.getByLabel("Lender", { exact: true }).locator("option:checked")).toHaveText(`Bank ${tag}`);
  await pick(page, "Paid into", /1010/);
  await page.getByLabel("Amount (MVR)").fill("250000");
  await page.getByRole("button", { name: "Record financing" }).click();
  await expect(page.getByText("Recorded.")).toBeVisible();
  await page.waitForLoadState("networkidle");

  // + New lender in the Financing tab adds one in a pop-up and picks it
  await page.getByRole("button", { name: "+ New lender" }).click();
  const dialog = page.getByRole("dialog", { name: "New lender" });
  await dialog.getByLabel("Name", { exact: true }).fill(`Friend ${tag}`);
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Lender", { exact: true }).locator("option:checked")).toHaveText(`Friend ${tag}`);
  expect(page.url()).toContain(`/projects/${project}`);
  await pick(page, "Paid into", /1010/);
  await page.getByLabel("Amount (MVR)").fill("50000");
  await page.getByRole("button", { name: "Record financing" }).click();
  await expect(page.getByRole("cell", { name: `Friend ${tag}` }).first()).toBeVisible();

  // both show on the Lenders page with what they lent, and the loan on the lender's page
  await page.goto(`/partners/lenders?q=${tag}`);
  const bank = page.getByRole("row").filter({ hasText: `Bank ${tag}` });
  await expect(bank).toContainText("250,000.00");
  await expect(page.getByRole("row").filter({ hasText: `Friend ${tag}` })).toContainText("50,000.00");
  await bank.getByRole("link", { name: `Bank ${tag}` }).click();
  await expect(page.getByRole("row").filter({ hasText: `LN-${tag}` }).filter({ hasText: "Loan" })).toContainText("250,000.00");

  // Partners & financing lists them as lenders; the lender ledger balances
  await page.goto("/partners");
  await expect(page.getByRole("row").filter({ hasText: `Bank ${tag}` })).toContainText("Lender");
  expect(sql(`select count(*) filter (where not ok) from health_check('live')`)).toBe("0");
  w.assertNone();
});
