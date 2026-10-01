"use client";

import { useEffect } from "react";

/** A dialog that closes on Escape or a click outside. */
export function Modal({ title, onClose, children, size = "lg" }: { title: string; onClose: () => void; children: React.ReactNode; size?: "md" | "lg" }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className={`my-6 w-full ${size === "md" ? "max-w-2xl" : "max-w-6xl"} rounded-xl bg-[var(--bg,var(--surface))] shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--muted)] hover:text-[var(--text)]">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
