import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { signIn, watchErrors } from "./helpers";

/** The board cut planner's list: saved to the account, opened on another device, and never overwritten by a stale page. */
const DB = process.env.E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-Atq", "-c", q], { encoding: "utf8" }).trim();
const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const saved = () => sql(`select data::text from cut_lists where user_id = '${ADMIN}'`);

test("the cut list is saved to the account and opens on another device", async ({ page, browser }) => {
  const w = watchErrors(page);
  sql(`delete from cut_lists where user_id = '${ADMIN}'`); // a clean start on the throwaway test database
  await signIn(page, "admin");
  await page.goto("/cut-planner");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Clear all" }).click();

  // two sizes and one unit, typed the way it is said: a 3 x 4 ft top
  await page.getByLabel("Type parts").fill("Table top 3 x 4 ft");
  await expect(page.getByText(/✓ Table top · 3' × 4' feet/)).toBeVisible();
  await page.getByLabel("Type parts").press("Enter");
  await expect(page.getByLabel("Table top unit")).toHaveValue("ft");
  await expect(page.getByLabel("Table top length")).toHaveValue("3");
  // each part has its own unit: a shelf in mm next to it
  await page.getByRole("button", { name: "+ Add a part" }).click();
  await page.getByLabel("Part 2 name").fill("Shelf");
  await page.getByLabel("Shelf unit").selectOption("mm");
  await page.getByLabel("Shelf length").fill("600");
  await page.getByLabel("Shelf width").fill("300");
  await expect(page.getByText(/^Saved to your account:/)).toBeVisible();
  // the note shows from the first save already: wait for the last one to land
  await expect.poll(saved).toContain('"Shelf"');

  // another device: the same list opens there
  const other = await browser.newContext();
  const phone = await other.newPage();
  await signIn(phone, "admin");
  await phone.goto("/cut-planner");
  await expect(phone.getByLabel("Table top length")).toHaveValue("3");
  await expect(phone.getByLabel("Shelf unit")).toHaveValue("mm");
  await phone.getByLabel("Shelf quantity").fill("3");
  await expect(phone.getByText(/^Saved to your account:/)).toBeVisible();
  await expect.poll(saved).toContain('"qty": "3"');

  // back on the first device, it shows the phone's change
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Shelf quantity")).toHaveValue("3");

  // the phone changes it again while the first device is not looking; an edit there is not lost silently
  await phone.getByLabel("Shelf quantity").fill("5");
  await expect(phone.getByText(/^Saved to your account:/)).toBeVisible();
  await expect.poll(saved).toContain('"qty": "5"');
  await page.getByLabel("Table top quantity").fill("2");
  const alert = page.getByRole("alert").filter({ hasText: "changed on another device" });
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Keep this one" }).click();
  await expect(page.getByText(/^Saved to your account:/)).toBeVisible();
  await expect.poll(() => (JSON.parse(saved()) as { rows: { name: string; qty: string }[] }).rows.map((r) => `${r.name} ${r.qty}`))
    .toEqual(["Table top 2", "Shelf 3"]);

  await other.close();
  w.assertNone();
});
