"use client";

import { useActionState, useEffect, useRef } from "react";
import { addVariation, updateVariation } from "@/app/actions/project-items";
import type { Result } from "@/app/actions/projects";
import { today } from "@/lib/format";

export interface VariationValues {
  id?: string;
  description?: string | null;
  cost_impact?: number;
  time_impact_days?: number;
  raised_date?: string | null;
}

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-sm font-medium";

/** Add or edit a variation. Nothing is asked for until it is needed. */
export function VariationModal({
  open,
  onClose,
  projectId,
  values,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  values?: VariationValues;
}) {
  const editing = Boolean(values?.id);
  const [state, action, pending] = useActionState(
    editing ? updateVariation : addVariation,
    null as Result | null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true"
      aria-label={editing ? "Edit variation" : "Add variation"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--field)] shadow-[0_24px_60px_-20px_rgba(13,27,42,0.4)]"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">
              {editing ? "Edit variation" : "Add variation"}
            </h2>
            <p className="text-xs text-[var(--muted)]">
              Extra work agreed after the contract — it raises the project value
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-[var(--muted)] transition-colors hover:text-[var(--text)]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form ref={formRef} action={action} className="space-y-4 px-5 py-5">
          <input type="hidden" name="project_id" value={projectId} />
          {values?.id && <input type="hidden" name="id" value={values.id} />}

          <div>
            <label htmlFor="v-description" className={label}>Description</label>
            <input id="v-description" name="description" required autoFocus
              defaultValue={values?.description ?? ""} className={input}
              placeholder="Kitchen specification upgrade across all units" />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="v-value" className={label}>Value (MVR)</label>
              <input id="v-value" name="cost_impact" type="number" step="0.01" required
                defaultValue={values?.cost_impact ?? ""} className={input} />
            </div>
            <div>
              <label htmlFor="v-days" className={label}>Duration (days)</label>
              <input id="v-days" name="time_impact_days" type="number" min="0"
                defaultValue={values?.time_impact_days ?? 0} className={input} />
            </div>
            <div>
              <label htmlFor="v-date" className={label}>Date</label>
              <input id="v-date" name="raised_date" type="date"
                defaultValue={values?.raised_date ?? today()}
                className={input} />
            </div>
          </div>

          {state?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={pending}
              className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-60">
              {pending ? "Saving…" : editing ? "Save changes" : "Add variation"}
            </button>
            <button type="button" onClick={onClose}
              className="text-sm text-[var(--muted)] hover:underline">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
