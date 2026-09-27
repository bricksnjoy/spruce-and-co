/**
 * Quotations and invoices share one template shape: a header (who we are and
 * what the document is), a body (the table of work and the totals) and a tail
 * (terms, signatures and the footer band).
 */

export type DocKind = "quotation" | "invoice";

export interface TemplateHeader {
  show_logo: boolean;
  company_name: string;
  /** the line under the name — PRIVATE LIMITED */
  company_sub: string;
  /** our address block, one line per line, email included */
  address: string;
  tin: string;
  /** the big word at the top right — QUOTATION, INVOICE */
  title: string;
  /** printed before the number — Quote#, Invoice# */
  number_label: string;
  /** numbers run on from this; {YY} or {YYYY} become the year, e.g. SC-Q/{YY}/ */
  number_prefix: string;
  /** pad the running number to this many digits — 2 gives 06 */
  number_pad: number;
  accent: string;
}

export interface TemplateBody {
  intro: string;
  /** Quote To:, Bill To: */
  to_label: string;
  col_description: string;
  col_unit: string;
  col_qty: string;
  col_rate: string;
  col_total: string;
  show_unit: boolean;
  /** print the job's duration beside the date */
  show_duration: boolean;
  tax_label: string;
  tax_rate: number;
  /** quotations: how long a quote stands */
  valid_days?: number;
  /** invoices: how long the client has to pay */
  due_days?: number;
}

export interface TemplateTail {
  /** one term per line; each prints on its own line */
  terms: string;
  /** a line under the terms — who to call, how long the quote stands */
  closing_note: string;
  /** who signs by default — each document can pick someone else */
  signatory_id: string;
  /** stamp documents by default */
  show_stamp: boolean;
  /** printed when no signatory is chosen */
  signatory_name: string;
  signatory_title: string;
  show_client_signature: boolean;
  bank_details: string;
  footer_text: string;
}

/** Someone who can sign a quotation or invoice, with their signature image. */
export interface Signatory {
  id: string;
  name: string;
  title: string | null;
  /** short-lived link to their signature, if one is uploaded */
  signatureUrl: string | null;
}

/** The company stamp and everyone who can sign, ready to put on a page. */
export interface SigningKit {
  stampUrl: string | null;
  signatories: Signatory[];
}

/**
 * Who signs a document and whether it is stamped: the document's own choice,
 * else its template's default.
 */
export function signerFor(
  kit: SigningKit,
  tail: TemplateTail,
  signatoryId: string | null | undefined,
  showStamp: boolean | null | undefined,
) {
  const s = kit.signatories.find((x) => x.id === (signatoryId ?? tail.signatory_id));
  return {
    name: s?.name ?? tail.signatory_name,
    title: s?.title ?? tail.signatory_title,
    signatureUrl: s?.signatureUrl ?? null,
    stampUrl: (showStamp ?? tail.show_stamp) ? kit.stampUrl : null,
  };
}

export interface Template {
  id: string;
  kind: DocKind;
  name: string;
  is_default: boolean;
  header: TemplateHeader;
  body: TemplateBody;
  tail: TemplateTail;
}

export const DEFAULT_HEADER: TemplateHeader = {
  show_logo: true,
  company_name: "Spruce & Co",
  company_sub: "PRIVATE LIMITED",
  address: "",
  tin: "",
  title: "QUOTATION",
  number_label: "Quote#",
  number_prefix: "SC-Q/{YY}/",
  number_pad: 2,
  accent: "#0b1f3a",
};

export const DEFAULT_BODY: TemplateBody = {
  intro: "",
  to_label: "Quote To:",
  col_description: "Item & Description",
  col_unit: "Unit",
  col_qty: "Qty",
  col_rate: "Rate",
  col_total: "Amount",
  show_unit: false,
  show_duration: true,
  tax_label: "GST",
  tax_rate: 8,
  valid_days: 60,
  due_days: 2,
};

export const DEFAULT_TAIL: TemplateTail = {
  terms: "",
  closing_note: "",
  signatory_id: "",
  show_stamp: true,
  signatory_name: "",
  signatory_title: "",
  show_client_signature: false,
  bank_details: "",
  footer_text: "",
};

/** A stored template, with anything missing filled in so the page never breaks. */
export function toTemplate(row: {
  id: string;
  kind: string;
  name: string;
  is_default: boolean;
  header: unknown;
  body: unknown;
  tail: unknown;
}): Template {
  const kind = row.kind as DocKind;
  return {
    id: row.id,
    kind,
    name: row.name,
    is_default: row.is_default,
    header: {
      ...DEFAULT_HEADER,
      title: kind === "invoice" ? "INVOICE" : "QUOTATION",
      number_label: kind === "invoice" ? "Invoice#" : "Quote#",
      number_prefix: kind === "invoice" ? "SC-INV/{YY}/" : "SC-Q/{YY}/",
      ...((row.header as Partial<TemplateHeader>) ?? {}),
    },
    body: {
      ...DEFAULT_BODY,
      to_label: kind === "invoice" ? "Bill To:" : "Quote To:",
      show_duration: kind !== "invoice",
      ...((row.body as Partial<TemplateBody>) ?? {}),
    },
    tail: { ...DEFAULT_TAIL, ...((row.tail as Partial<TemplateTail>) ?? {}) },
  };
}

/** SC-Q/{YY}/, 6 and a pad of 2 → SC-Q/26/06 */
export function docNumber(prefix: string, seq: number, on: Date | string = new Date(), pad = 0) {
  const year = String(new Date(on).getFullYear());
  return `${(prefix || "").replaceAll("{YYYY}", year).replaceAll("{YY}", year.slice(2))}${String(seq).padStart(
    Math.max(0, Math.min(Number(pad) || 0, 8)),
    "0",
  )}`;
}

export const QUOTE_STATUSES = ["draft", "sent", "won", "lost", "expired", "cancelled"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  won: "Won",
  lost: "Lost",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const INVOICE_STATUSES = ["draft", "sent", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-sky-50 text-sky-700",
  won: "bg-emerald-50 text-emerald-700",
  paid: "bg-emerald-50 text-emerald-700",
  lost: "bg-red-50 text-red-700",
  expired: "bg-amber-50 text-amber-800",
  cancelled: "bg-slate-100 text-slate-500 line-through",
};

export interface DocLine {
  title: string | null;
  description: string | null;
  unit: string | null;
  qty: number;
  rate: number;
  /** what this document charges for the line — qty × rate, or a part of it on an invoice */
  amount: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** 2026-01-31 plus 2 days → 2026-02-02, worked in UTC so no timezone shifts the day */
export function addDays(d: string, days: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

/**
 * Split a quotation's lines for an invoice charging `pct` of it. Each line is
 * charged the same share, and the largest line takes the rounding so the
 * invoice adds up to exactly `target`.
 */
export function portionLines(lines: Omit<DocLine, "amount">[], pct: number, target: number): DocLine[] {
  const out = lines.map((l) => ({ ...l, amount: round2((l.qty * l.rate * pct) / 100) }));
  const drift = round2(target - out.reduce((s, l) => s + l.amount, 0));
  if (out.length && Math.abs(drift) > 0) {
    // the largest line absorbs it, where a laari either way goes unnoticed
    const i = out.reduce((best, l, k) => (l.amount > out[best].amount ? k : best), 0);
    out[i].amount = round2(out[i].amount + drift);
  }
  return out;
}
