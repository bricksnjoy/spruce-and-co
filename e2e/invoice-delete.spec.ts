import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { signIn, watchErrors } from "./helpers";

const DB = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-Atq", "-c", q], { encoding: "utf8" }).trim();
const tag = Date.now().toString(36).slice(-5).toUpperCase();

test("an invoice is deleted from its billing stage, leaves Sales, and comes back on restore", async ({ page }) => {
  const w = watchErrors(page);
  const client = sql(`insert into contacts (name, kinds) values ('Health ${tag}', '{customer}') returning id`);
  const project = sql(`insert into projects (code, name, customer_id, contract_value, status, start_date) values ('ID-${tag}', 'Call centre ${tag}', '${client}', 100000, 'in_progress', current_date) returning id`);
  sql(`insert into billing_stages (project_id, name, basis, value) values ('${project}', 'Advance', 'percent', 20)`);
  await signIn(page, "admin");

  await page.goto(`/projects/${project}?tab=billing`);
  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.waitForURL(/\/sales\/[0-9a-f-]{36}\/edit/);
  await page.goto(`/projects/${project}?tab=billing`);
  await expect(page.getByRole("link", { name: "View invoice" })).toBeVisible();
  const invoice = sql(`select invoice_id from billing_stages where project_id = '${project}'`);
  const number = sql(`select number from transactions where id = '${invoice}'`);

  await page.getByRole("button", { name: "Delete invoice" }).click();
  await page.getByRole("dialog", { name: `Delete ${number}` }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: "Create invoice" })).toBeVisible();

  await page.goto("/sales");
  await expect(page.getByRole("link", { name: number, exact: true })).toHaveCount(0);
  await page.goto("/sales?show=deleted");
  await page.getByRole("link", { name: number, exact: true }).click();
  await expect(page.getByText(/^Deleted /)).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText(/^Deleted /)).toHaveCount(0);

  await page.goto(`/projects/${project}?tab=billing`);
  await expect(page.getByRole("link", { name: "View invoice" })).toBeVisible();
  w.assertNone();
});
