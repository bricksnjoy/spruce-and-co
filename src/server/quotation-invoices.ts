import type { Session } from "./session";
import type { SalesFormData } from "./sales-data";
import { blankDoc, type DocValues, type LineValue } from "@/lib/sales-doc";
import { portionLines, round2 } from "@/lib/documents";
import { dbToLaari, laariToNumber } from "@/lib/money";

type Supabase = Session["supabase"];

export type QuotationInvoice = { id: string; number: string | null; date: string; is_draft: boolean; subtotal: number; total: number };

/**
 * Invoices in the books raised from quotations, by quotation number. A quotation's
 * invoices carry its number as their reference, which also prints on the invoice.
 * Voided ones no longer count against what is left to bill.
 */
export async function quotationInvoices(supabase: Supabase, numbers: string[]): Promise<Map<string, QuotationInvoice[]>> {
  const out = new Map<string, QuotationInvoice[]>();
  if (!numbers.length) return out;
  const { data } = await supabase
    .from("transactions")
    .select("id, number, date, is_draft, reference, total_amount, transaction_lines(amount)")
    .eq("type", "invoice")
    .eq("book", "live")
    .is("voided_at", null)
    .in("reference", numbers)
    .order("date");
  for (const t of data ?? []) {
    const lines = (t.transaction_lines ?? []) as { amount: string | number }[];
    const subtotal = laariToNumber(lines.reduce((a, l) => a + dbToLaari(l.amount), 0n));
    const list = out.get(t.reference!) ?? [];
    list.push({ id: t.id, number: t.number, date: t.date, is_draft: t.is_draft, subtotal, total: laariToNumber(dbToLaari(t.total_amount)) });
    out.set(t.reference!, list);
  }
  return out;
}

export const invoicedOf = (list: QuotationInvoice[] | undefined) => round2((list ?? []).reduce((a, i) => a + i.subtotal, 0));

/**
 * A new invoice filled in from a won quotation, for a percentage of it: the
 * customer, project and lines come across, and its number goes in as the
 * reference so the quotation keeps count of what has been billed.
 */
export async function invoiceFromQuotation(
  s: Session,
  data: SalesFormData,
  quotationId: string,
  pctInput: string,
): Promise<{ values: DocValues; quotation: { id: string; number: string } } | { error: string }> {
  const pct = Number(pctInput);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { error: "Choose how much of the quotation to invoice." };
  const [{ data: q }, { data: items }] = await Promise.all([
    s.supabase.from("quotations").select("id, number, title, status, client_id, project_id").eq("id", quotationId).maybeSingle(),
    s.supabase.from("quotation_items").select("title, description, unit, qty, rate").eq("quotation_id", quotationId).order("sort_order"),
  ]);
  if (!q) return { error: "That quotation no longer exists." };
  if (q.status !== "won") return { error: "Only a won quotation can be invoiced." };

  const lines = (items ?? []).map((l) => ({ title: l.title, description: l.description, unit: l.unit, qty: Number(l.qty), rate: Number(l.rate) }));
  const subtotal = round2(lines.reduce((a, l) => a + l.qty * l.rate, 0));
  if (subtotal <= 0) return { error: "This quotation has nothing to invoice." };
  const remaining = round2(subtotal - invoicedOf((await quotationInvoices(s.supabase, [q.number])).get(q.number)));
  const target = round2((subtotal * pct) / 100);
  if (target > remaining + 0.005) return { error: `Only ${remaining.toFixed(2)} of this quotation is left to invoice.` };

  // the customer is the one mirrored from the quotation's client, else the project's
  const [{ data: contact }, project] = await Promise.all([
    q.client_id
      ? s.supabase.from("contacts").select("id").eq("book", "live").eq("legacy->>client_id", q.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    Promise.resolve(data.projects.find((p) => p.id === q.project_id)),
  ]);
  const customerId = contact?.id ?? project?.customer_id ?? "";

  const whole = pct >= 99.995;
  const part = whole ? "" : ` (${Number(pct.toFixed(2))}%)`;
  const describe = (l: { title: string | null; description: string | null }) => [l.title, l.description].filter(Boolean).join("\n");
  const docLines: LineValue[] = whole
    ? lines.map((l) => ({ description: describe(l), qty: String(l.qty), rate: String(l.rate), amount: "", tax_code_id: data.defaultTaxCode ?? "", project_id: "", account_id: "" }))
    : portionLines(lines, pct, target).map((l) => ({ description: describe(l) + part, qty: "", rate: "", amount: l.amount.toFixed(2), tax_code_id: data.defaultTaxCode ?? "", project_id: "", account_id: "" }));

  const values = blankDoc("invoice", data, customerId, project?.id ?? "");
  return {
    values: { ...values, reference: q.number, memo: [q.title, part.trim()].filter(Boolean).join(" "), lines: docLines },
    quotation: { id: q.id, number: q.number },
  };
}
