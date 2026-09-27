"use client";

import { useEffect, useState, type ReactNode } from "react";
import { VIEW_COOKIE, type ProjectView } from "@/lib/project-view";

export type SectionKey =
  | "cost"
  | "profit"
  | "investments"
  | "bills"
  | "variations"
  | "quotations";

export interface Section {
  title: string;
  /** one figure worth seeing before the box is opened */
  summary: string;
  node: ReactNode;
}

// the boxes, in the order they are laid out
const BOX_ORDER: SectionKey[] = ["cost", "profit", "investments", "bills", "variations", "quotations"];

/**
 * The project's sections, laid out either as the full page (classic) or as a
 * row of boxes that each open to show one section at a time.
 */
export function ProjectViews({
  initialView,
  sections,
}: {
  initialView: ProjectView;
  sections: Record<SectionKey, Section>;
}) {
  const [view, setView] = useState<ProjectView>(initialView);
  const [openBox, setOpenBox] = useState<SectionKey | null>(null);

  // remembered for every project, so each one opens the way it was left
  useEffect(() => {
    document.cookie = `${VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
  }, [view]);

  return (
    <div className="mt-6">
      <div className="mb-4 flex justify-end">
        <div role="group" aria-label="Layout"
          className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--field)] p-0.5 text-xs font-medium">
          {(["classic", "boxes"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                view === v ? "bg-[var(--brand)] text-white" : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}>
              {v === "classic" ? "Full page" : "Boxes"}
            </button>
          ))}
        </div>
      </div>

      {view === "classic" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {sections.cost.node}
          {sections.profit.node}
          <div className="xl:col-span-2">{sections.quotations.node}</div>
          <div className="xl:col-span-2">{sections.variations.node}</div>
          <div className="xl:col-span-2">{sections.investments.node}</div>
          <div className="xl:col-span-2">{sections.bills.node}</div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
            {BOX_ORDER.map((k) => {
              const s = sections[k];
              const active = openBox === k;
              return (
                <button key={k} type="button" aria-expanded={active}
                  onClick={() => setOpenBox(active ? null : k)}
                  className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--brand)] hover:bg-[var(--hover)]"
                  }`}>
                  <span className={`block text-sm font-semibold ${active ? "text-[var(--brand)]" : ""}`}>
                    {s.title}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">{s.summary}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            {openBox ? (
              sections[openBox].node
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--border)] px-5 py-10 text-center text-sm text-[var(--muted)]">
                Choose a box to see that part of the project.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
