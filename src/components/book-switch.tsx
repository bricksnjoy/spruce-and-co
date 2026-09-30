"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { setBook } from "@/app/actions/book";
import type { Book } from "@/lib/books";

/** Live / Test switch in the top bar. */
export function BookSwitch({ book }: { book: Book }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const choose = (b: Book) => {
    if (b === book || pending) return;
    setError(null);
    start(async () => {
      const r = await setBook(b);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  };

  const btn = (b: Book, label: string) => (
    <button
      type="button"
      onClick={() => choose(b)}
      aria-pressed={book === b}
      disabled={pending}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
        book === b
          ? b === "sandbox" ? "bg-amber-500 text-white" : "bg-[var(--brand)] text-white"
          : "text-[var(--muted)] hover:text-[var(--text)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="Which books" title={error ?? "Live is the real books; Test is for trying things out"}
        className="flex rounded-lg border border-[var(--border)] p-0.5">
        {btn("live", "Live")}
        {btn("sandbox", "Test")}
      </div>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
