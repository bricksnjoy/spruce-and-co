/** GST return periods as the database works them out (gst_period_for), for screens that show a period before it has any lines. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export type Period = { start: string; end: string; due: string };

/** The return period a date falls in, with its due date (the due day of the month after it ends). */
export function periodFor(date: string, months: number, dueDay: number): Period {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const sm = Math.floor((m - 1) / months) * months + 1;
  const em = sm + months - 1;
  const last = new Date(Date.UTC(y, em, 0)).getUTCDate();
  const [dy, dm] = em === 12 ? [y + 1, 1] : [y, em + 1];
  return { start: `${y}-${pad(sm)}-01`, end: `${y}-${pad(em)}-${pad(last)}`, due: `${dy}-${pad(dm)}-${pad(dueDay)}` };
}

/** "Q1 2026" for a quarter, "Mar 2026" for a month, otherwise "Jan–Mar 2026". */
export function periodLabel(start: string, end: string) {
  const y = start.slice(0, 4), sm = Number(start.slice(5, 7)), em = Number(end.slice(5, 7));
  if (sm === em) return `${MONTHS[sm - 1]} ${y}`;
  if (em - sm === 2 && (sm - 1) % 3 === 0) return `Q${(sm + 2) / 3} ${y}`;
  return `${MONTHS[sm - 1]}–${MONTHS[em - 1]} ${y}`;
}

export type ScheduleRow = { side: "output" | "input"; transaction_id: string; date: string; type: string; number: string | null;
  contact_name: string | null; tin: string | null; tax_invoice_no: string | null; tax_invoice_date: string | null; customs_ref: string | null;
  taxable: number | string | null; gst: number | string; late: boolean; correction: boolean };

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One side of a return's schedule as CSV (amounts as stored, to the laari). */
export function scheduleCsv(rows: ScheduleRow[], side: "output" | "input") {
  const head = side === "output"
    ? ["Date", "Document", "Number", "Customer", "Customer TIN", "Taxable value (MVR)", "GST (MVR)", "Note"]
    : ["Date", "Document", "Number", "Supplier", "Supplier TIN", "Tax invoice no", "Tax invoice date", "Customs declaration", "Taxable value (MVR)", "GST (MVR)", "Note"];
  const note = (r: ScheduleRow) => r.correction ? "Correction to a filed return" : r.late ? "Dated in an earlier, filed period" : "";
  const body = rows.filter((r) => r.side === side).map((r) => side === "output"
    ? [r.date, r.type, r.number, r.contact_name, r.tin, r.taxable, r.gst, note(r)]
    : [r.date, r.type, r.number, r.contact_name, r.tin, r.tax_invoice_no, r.tax_invoice_date, r.customs_ref, r.taxable, r.gst, note(r)]);
  return [head, ...body].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
