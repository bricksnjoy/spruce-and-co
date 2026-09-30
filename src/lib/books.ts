/**
 * Live and Test (decision Q2). Both books share one database and never mix:
 * the database keeps them apart. The screens built on the new ledger follow
 * whichever book you are in; the older screens read tables that have no book,
 * so they are Live-only and are hidden while you work in Test.
 */
export type Book = "live" | "sandbox";

/** Screens that follow the book you are in. Grows as each module is rebuilt. */
export const BOOK_AWARE: string[] = [
  "/",
  "/settings",
  "/accounting/chart",
  "/accounting/health",
  "/sales",
  "/expenses",
  "/projects",
  "/payroll",
  "/banking",
  "/taxes",
  "/partners",
  "/reports",
];

/** Parts of a book-aware area that still read the old tables. */
const LIVE_ONLY: RegExp[] = [/^\/projects\/[^/]+\/legacy(\/|$)/];

export function worksInTest(pathname: string) {
  if (LIVE_ONLY.some((r) => r.test(pathname))) return false;
  return BOOK_AWARE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const bookLabel = (b: Book) => (b === "sandbox" ? "Test" : "Live");
