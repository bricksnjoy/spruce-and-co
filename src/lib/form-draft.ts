"use client";

import { useEffect, type RefObject } from "react";

/** Where a new form's unsaved typing is kept on this device, by form. */
export const draftKey = (name: string) => `draft:${name}`;

export function hasDraft(name: string): boolean {
  try { return Boolean(localStorage.getItem(draftKey(name))); } catch { return false; }
}

export function clearDraft(name: string) {
  try { localStorage.removeItem(draftKey(name)); } catch { /* storage blocked: nothing kept */ }
}

/**
 * Keep what is typed into a form on this device, so a refresh or a dropped
 * connection does not lose it: the fields are put back when the form opens
 * again. `name` null switches it off (e.g. when editing a saved record).
 */
export function useFormDraft(form: RefObject<HTMLFormElement | null>, name: string | null) {
  useEffect(() => {
    const f = form.current;
    if (!f || !name) return;
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey(name)) ?? "null") as Record<string, string | boolean> | null;
      if (saved) {
        for (const el of Array.from(f.elements) as HTMLInputElement[]) {
          if (!el.name || !(el.name in saved) || el.type === "hidden") continue;
          if (el.type === "checkbox") el.checked = Boolean(saved[el.name]);
          else if (el.type === "radio") el.checked = saved[el.name] === el.value;
          else el.value = String(saved[el.name]);
        }
      }
    } catch { /* a broken draft is ignored */ }
    const keep = () => {
      const out: Record<string, string | boolean> = {};
      for (const el of Array.from(f.elements) as HTMLInputElement[]) {
        if (!el.name || el.type === "hidden" || el.type === "file") continue;
        if (el.type === "checkbox") out[el.name] = el.checked;
        else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
        else out[el.name] = el.value;
      }
      try { localStorage.setItem(draftKey(name), JSON.stringify(out)); } catch { /* storage full or blocked */ }
    };
    f.addEventListener("input", keep);
    f.addEventListener("change", keep);
    return () => { f.removeEventListener("input", keep); f.removeEventListener("change", keep); };
  }, [form, name]);
}
