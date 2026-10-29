import { test, expect } from "@playwright/test";
import { signIn, watchErrors } from "./helpers";

/** Bids: add one with its dates, move it along with a note, and find its dates on the calendar. */
const tag = Date.now().toString(36).slice(-5).toUpperCase();

test("bids: add, move through the stages, and see the dates on Tasks & Calendar", async ({ page }) => {
  const w = watchErrors(page);
  await signIn(page, "admin");
  await page.goto("/bids");
  await page.getByRole("button", { name: "+ New bid" }).click();
  const form = page.getByRole("dialog", { name: "New bid" });
  await form.getByLabel("Bid name").fill(`School hall ${tag}`);
  await form.getByLabel("Company").fill("Ministry of Education");
  await form.getByLabel("Location").fill("Th. Vilufushi");
  await form.getByLabel("Gazette link").fill("https://www.gazette.gov.mv/iulaan/123");
  const soon = new Date(Date.now() + 3 * 86400_000 + 5 * 3600_000).toISOString().slice(0, 10);
  await form.getByLabel("Pre-bid meeting", { exact: true }).fill(`${soon}T10:00`);
  await form.getByLabel("Compulsory").check();
  await form.getByLabel("Submission deadline").fill(`${soon}T14:00`);
  await form.getByRole("button", { name: "Add bid" }).click();

  // the new bid opens on its own page, registered
  await expect(page.getByRole("heading", { name: `School hall ${tag}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registered", pressed: true })).toBeVisible();
  await page.getByLabel("Note with the change (optional)").fill("papers collected");
  await page.getByRole("button", { name: "Papers ready" }).click();
  await expect(page.getByRole("button", { name: "Papers ready", pressed: true })).toBeVisible();
  await expect(page.getByText("papers collected")).toBeVisible();

  // listed under its stage, and both dates on the calendar
  await page.goto("/bids?status=papers_ready");
  await expect(page.getByRole("link", { name: `School hall ${tag}` })).toBeVisible();
  await page.goto("/tasks");
  const dates = page.locator("tr", { hasText: `School hall ${tag}` });
  await expect(dates).toHaveCount(2);
  await expect(dates.filter({ hasText: "Pre-bid meeting (compulsory)" })).toHaveCount(1);
  await expect(dates.filter({ hasText: "Submission deadline" })).toHaveCount(1);
  w.assertNone();
});
