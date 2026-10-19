"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()}
      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--brand-soft)]">Print</button>
  );
}
