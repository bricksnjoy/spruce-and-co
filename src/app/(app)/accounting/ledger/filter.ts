import type { Entry, EntryKind } from "@/lib/accounting";

export interface LedgerFilter {
  p?: string;
  from?: string;
  to?: string;
  kind?: string;
  account?: string;
  project?: string;
  q?: string;
  transfers?: string;
}

/** The entries the filters ask for, within the period. */
export function filterEntries(entries: Entry[], f: LedgerFilter, from: string, to: string) {
  const q = f.q?.trim().toLowerCase();
  return entries.filter(
    (e) =>
      e.date >= from &&
      e.date <= to &&
      (f.transfers === "1" || e.cash) &&
      (!f.kind || e.kind === (f.kind as EntryKind)) &&
      (!f.account || e.account === f.account) &&
      (!f.project || e.project?.id === f.project) &&
      (!q || [e.description, e.account, e.party ?? "", e.project?.code ?? "", e.project?.name ?? ""].some((s) => s.toLowerCase().includes(q))),
  );
}
