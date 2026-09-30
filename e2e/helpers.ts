import { expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-Passw0rd!";
export const USERS = { admin: "admin@e2e.test", manager: "manager@e2e.test", viewer: "viewer@e2e.test" } as const;

/** Sign in through the real login form. */
export async function signIn(page: Page, who: keyof typeof USERS) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS[who]);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Collect console errors and page errors; every test fails if any appear (§13 build checks). */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console [${page.url()}]: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`page [${page.url()}]: ${e.message.slice(0, 120)}`));
  return { errors, assertNone: () => expect(errors, errors.join("\n")).toEqual([]) };
}

/** A page rendered properly: no Next error screen, no 404. */
export async function expectRendered(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("This page could not be found");
  await expect(page.locator("body")).not.toContainText("Internal Server Error");
}
