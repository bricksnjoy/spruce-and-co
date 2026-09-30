"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BOOK_AWARE, worksInTest, type Book } from "@/lib/books";
import { BookSwitch } from "./book-switch";

const NAMES: Record<string, string> = {
  "/settings": "Settings",
  "/accounting/chart": "Chart of accounts",
  "/accounting/health": "Health check",
  "/sales": "Sales",
  "/expenses": "Expenses",
  "/projects": "Projects",
  "/payroll": "Payroll",
};

/**
 * In the Test book, screens that still read the old tables are not shown:
 * they would put real figures beside test ones.
 */
export function BookGuard({ book, children }: { book: Book; children: ReactNode }) {
  const pathname = usePathname();
  if (book !== "sandbox" || worksInTest(pathname)) return <>{children}</>;
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-amber-300 bg-amber-50 px-6 py-8 text-center">
      <h1 className="text-lg font-semibold">This screen is Live only</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        It still reads the old books, which have no Test copy, so it is hidden while you work in Test.
        Switch back to Live to use it, or open a screen that works in Test.
      </p>
      <div className="mt-5 flex justify-center"><BookSwitch book={book} /></div>
      <ul className="mt-5 flex flex-wrap justify-center gap-2 text-sm">
        {BOOK_AWARE.map((href) => (
          <li key={href}>
            <Link href={href} className="rounded-full border border-amber-300 bg-white px-3 py-1 font-medium text-[var(--brand)] hover:underline">
              {NAMES[href] ?? href}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
