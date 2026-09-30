/**
 * Live and Test (decision Q2). Both books share one database and never mix:
 * the database keeps them apart. The screens built on the new ledger follow
 * whichever book you are in; the older screens read tables that have no book,
 * so they are Live-only and are hidden while you work in Test.
 */
export type Book = "live" | "sandbox";

/** Screens that follow the book you are in. Grows as each module is rebuilt. */
export const BOOK_AWARE: string[] = [
  "/settings",
  "/accounting/chart",
  "/accounting/health",
  "/sales/customers",
  "/expenses/vendors",
];

export function worksInTest(pathname: string) {
  return BOOK_AWARE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const bookLabel = (b: Book) => (b === "sandbox" ? "Test" : "Live");
