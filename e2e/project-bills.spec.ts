import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { signIn, watchErrors } from "./helpers";

/** Bills inside a project: the pop-up form, and the sheet — download, fill, upload, check, save, upload again. */
const DB = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-Atq", "-c", q], { encoding: "utf8" }).trim();
const tag = Date.now().toString(36).slice(-5).toUpperCase();
const digits = String(Date.now()).slice(-5);

test("bills inside a project: pop-up form, sheet upload with checking, download and upload again", async ({ page, request }) => {
  const w = watchErrors(page);
  const project = sql(`insert into projects (code, name, contract_value, status, start_date) values ('PB-${tag}', 'Bills ${tag}', 100000, 'in_progress', current_date) returning id`);
  const vendor = `Hardware ${tag}`;
  sql(`insert into contacts (name, kinds, tin, gst_registered) values ('${vendor}', '{vendor}', '10${digits}3GST501', true)`);
  await signIn(page, "admin");

  // the header's New bill opens the pop-up on the Bills tab
  await page.goto(`/projects/${project}`);
  await page.getByRole("link", { name: "New bill" }).click();
  const dialog = page.getByRole("dialog", { name: "New bill" });
  await expect(dialog).toBeVisible();
  const vendorSelect = dialog.getByLabel(/^Vendor/);
  await vendorSelect.selectOption(await vendorSelect.locator("option").filter({ hasText: vendor }).getAttribute("value") as string);
  await dialog.getByLabel("Tax invoice no.").fill(`HW-${tag}-1`);
  const acct = dialog.getByLabel("Line 1 account");
  await acct.selectOption(await acct.locator("option").filter({ hasText: /5000/ }).first().getAttribute("value") as string);
  await dialog.getByLabel("Line 1 amount before GST").fill("1000");
  await dialog.getByLabel("Line 1 GST").fill("80");
  await dialog.getByRole("button", { name: "Save bill" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Bill saved.")).toBeVisible();
  expect(page.url()).toContain(`/projects/${project}`);
  await expect(page.getByRole("cell", { name: vendor })).toBeVisible();

  // the template downloads with the right columns
  const cookies = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const tpl = await request.get(`/projects/${project}/bills/sheet?kind=template`, { headers: { cookie: cookies } });
  expect(tpl.status()).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await tpl.body() as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Bills")!;
  expect(ws.getRow(1).getCell(4).value).toBe("Vendor");
  expect(wb.getWorksheet("Accounts")!.rowCount).toBeGreaterThan(5);

  // fill it: one bill of two lines, one single-line bill from a new vendor, and one bad row
  const today = new Date().toISOString().slice(0, 10);
  ws.addRow(["", today, "", vendor, "", `HW-${tag}-2`, "", "Cement", "5000", 2000, 160, "Y", ""]);
  ws.addRow(["", today, "", vendor, "", `HW-${tag}-2`, "", "Delivery", "5040", 300, 24, "Y", ""]);
  ws.addRow(["", today, "", `New Shop ${tag}`, "", "", "", "Nails", "5000", 45.5, "", "N", ""]);
  ws.addRow(["", "someday", "", vendor, "", "", "", "Broken row", "9999", -1, "", "", ""]);
  const dir = mkdtempSync(join(tmpdir(), "bills-"));
  const file = join(dir, "bills.xlsx");
  await wb.xlsx.writeFile(file);

  await page.getByLabel("Filled bills sheet").setInputFiles(file);
  const check = page.getByRole("dialog", { name: "Check the bills before saving" });
  await expect(check).toBeVisible();
  await expect(check.getByText(/1 with problems/)).toBeVisible();
  await expect(check.getByRole("button", { name: /Save 2 bills/ })).toBeDisabled();

  // fix the sheet: drop the bad row, upload again, save
  ws.spliceRows(ws.rowCount, 1);
  await wb.xlsx.writeFile(file);
  await check.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Filled bills sheet").setInputFiles(file);
  await expect(check.getByText("new vendor")).toBeVisible();
  await check.getByRole("button", { name: "Save 2 bills" }).click();
  await expect(page.getByText(/Saved 2 bills/)).toBeVisible();
  const lines = sql(`select count(*) from transaction_lines l join transactions t on t.id = l.transaction_id where t.project_id = '${project}' and t.type = 'bill'`);
  expect(lines).toBe("4"); // the pop-up bill's line + 2 + 1

  // uploading the same sheet again saves nothing new
  await page.getByLabel("Filled bills sheet").setInputFiles(file);
  await expect(check.getByText(/3 already saved/)).toBeVisible();
  await expect(check.getByText("Nothing new to save.")).toBeVisible();
  await check.getByRole("button", { name: "Close" }).click();

  // the bills download has every line with its ID, ready to add more
  const exp = await request.get(`/projects/${project}/bills/sheet?kind=bills`, { headers: { cookie: cookies } });
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(await exp.body() as unknown as ArrayBuffer);
  const ws2 = wb2.getWorksheet("Bills")!;
  expect(ws2.rowCount).toBe(5); // heading + 4 lines
  ws2.addRow(["", today, "", vendor, "", `HW-${tag}-3`, "", "Paint", "5000", 500, 40, "Y", ""]);
  const file2 = join(dir, "bills-more.xlsx");
  await wb2.xlsx.writeFile(file2);
  await page.getByLabel("Filled bills sheet").setInputFiles(file2);
  await expect(check.getByText(/4 already saved/)).toBeVisible();
  await check.getByRole("button", { name: "Save 1 bill" }).click();
  await expect(page.getByText(/Saved 1 bill/)).toBeVisible();

  expect(sql(`select count(*) filter (where not ok) from health_check('live')`)).toBe("0");
  w.assertNone();
});
