// Plain helpers for a project's programme, usable on the server and in the browser.

interface PhaseSpan {
  start_date: string | null;
  end_date: string | null;
  progress_pct: number;
}

const DAY = 86_400_000;
const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
export const today = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

/** How far along the work is, weighted by each phase's length, and how far it should be by today. */
export function programmeProgress(phases: PhaseSpan[]) {
  const len = (p: PhaseSpan) => (p.start_date && p.end_date ? Math.max(1, daysBetween(p.start_date, p.end_date) + 1) : 1);
  const total = phases.reduce((s, p) => s + len(p), 0) || 1;
  const done = phases.reduce((s, p) => s + (len(p) * Number(p.progress_pct || 0)) / 100, 0);
  const t = today();
  const due = phases.reduce((s, p) => {
    if (!p.start_date || !p.end_date || t < p.start_date) return s;
    if (t > p.end_date) return s + len(p);
    return s + daysBetween(p.start_date, t) + 1;
  }, 0);
  return { actual: Math.round((done / total) * 100), expected: Math.round((due / total) * 100) };
}
