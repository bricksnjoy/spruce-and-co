import type { Company } from "./ledger-sheet";
import { laariToNumber } from "@/lib/money";
import { amountInWords } from "@/lib/words";

export type SheetCustomer = {
  name: string; company_name: string | null; address: string | null; tin: string | null;
  gst_registered: boolean | null; taxable_activity_no: string | null;
};
/** A heading line (A · Civil works, 1.0 · Preliminaries) has words and charges nothing. */
export type SheetLine = {
  itemNo?: string | null; description: string; heading?: boolean; unit?: string | null;
  qty: number | null; rate: bigint | null; amount: bigint; tax: bigint; taxName: string;
};
export type SheetSigner = { name: string | null; title: string | null; signatureUrl: string | null; stampUrl: string | null };

const n2 = (v: bigint) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(laariToNumber(v));
const d = (s: string | null | undefined) => s ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`)) : "";
const TITLE: Record<string, string> = { invoice: "TAX INVOICE", credit_note: "CREDIT NOTE", sales_receipt: "SALES RECEIPT" };
const NUMBER_LABEL: Record<string, string> = { invoice: "Invoice No:", credit_note: "Credit Note No:", sales_receipt: "Receipt No:" };

export const sheetTitle = (type: string, company: Company) =>
  type === "invoice" && !company.gst_registered ? "INVOICE" : TITLE[type];

/** the paper invoice is set in Times, its table of work in Arial */
const TIMES = { fontFamily: '"Times New Roman", Times, "Liberation Serif", serif' };
const ARIAL = { fontFamily: 'Arial, Helvetica, "Liberation Sans", sans-serif' };
/** the grid lines of the printed table */
const cell = "border border-black px-1.5 py-[3px] align-middle";
/** an empty row of the grid, as the paper invoice leaves room between sections */
const Blank = () => <tr>{Array.from({ length: 6 }, (_, i) => <td key={i} className={`${cell} h-[15px]`} />)}</tr>;
/** a section letter (A, B …) heads its section on a grey band */
const isSection = (no: string | null | undefined) => Boolean(no && /^[A-Z]{1,2}$/.test(no.trim()));

/**
 * A tax invoice, credit note or sales receipt as the customer sees it, laid
 * out as Spruce & Co's paper invoices are: the printed page, and the live
 * preview beside the form.
 */
export function SalesSheet({ type, company, number, voided = false, customer, date, due, projectCode, reference, agrNo = null, poNo = null,
  lines, currency, paid = 0n, balance = 0n, memo, signer, terms = "", footer = "" }: {
  type: string; company: Company; number: string | null; voided?: boolean; customer: SheetCustomer | null;
  date: string; due: string | null; projectCode: string | null; reference: string | null; agrNo?: string | null; poNo?: string | null;
  lines: SheetLine[]; currency: string; paid?: bigint; balance?: bigint; memo: string | null; signer: SheetSigner | null;
  /** the invoice template's terms, one per line, and its footer (Quotations → Templates) */
  terms?: string; footer?: string;
}) {
  const subtotal = lines.reduce((a, l) => a + l.amount, 0n);
  const gst = lines.reduce((a, l) => a + l.tax, 0n);
  const total = subtotal + gst;
  // "GST 8%" when every line is charged at one rate
  const rates = [...new Set(lines.filter((l) => l.amount !== 0n).map((l) => l.amount ? Number((l.tax * 10000n) / l.amount) / 100 : 0))];
  const gstLabel = rates.length === 1 && rates[0] > 0 ? `GST ${Math.round(rates[0] * 10) / 10}%` : "GST";
  const isInvoice = type === "invoice";
  const priced = lines.filter((l) => !l.heading);
  const termLines = terms.split("\n").map((t) => t.trim()).filter(Boolean);
  const companyLine = [company.address?.replace(/\s*\n\s*/g, ", "), company.registration_no && `Reg No: ${company.registration_no}`,
    company.phone && `T: ${company.phone}`, company.email && `E: ${company.email}`].filter(Boolean).join(" | ");
  const facts: [string, string | null][] = [
    ["Date:", d(date)],
    [NUMBER_LABEL[type] ?? "No:", number],
    ...(isInvoice
      ? [["Quotation No:", reference], ["AGR No:", agrNo], ["PO No:", poNo], ...(due && due !== date ? [["Due Date:", d(due)]] : [])] as [string, string | null][]
      : [["Reference:", reference]] as [string, string | null][]),
    ...(projectCode ? [["Project:", projectCode]] as [string, string | null][] : []),
  ];
  const fill = Math.max(0, 14 - lines.length - (memo ? memo.split("\n").length : 0));

  return (
    <div className="doc-sheet mx-auto flex min-h-[297mm] w-[210mm] max-w-full flex-col bg-white px-[14mm] pb-[10mm] pt-[12mm] text-[10.5px] leading-snug text-black shadow-[0_2px_18px_rgba(13,27,42,0.12)]" style={TIMES}>
      {/* our name and address beside the mark */}
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.png" alt="" className="h-[56px] w-[56px] object-contain" />
        <div className="text-[9.5px] leading-[1.35]">
          <p className="text-[11px] font-bold uppercase">{company.legal_name}</p>
          {company.trade_name && company.trade_name !== company.legal_name && <p>{company.trade_name}</p>}
          {company.address && <p className="whitespace-pre-line">{company.address}</p>}
        </div>
      </div>

      <div className="mt-1 text-center">
        <p className="text-[15px] font-bold tracking-wide underline">{sheetTitle(type, company)}</p>
        {company.tin && <p className="text-[8.5px] font-bold">TIN: {company.tin}</p>}
      </div>
      {voided && <p className="mt-2 border border-red-600 px-3 py-1 text-center text-[12px] font-bold text-red-700">VOID — this document has been cancelled</p>}

      {/* who it is for, and the document's numbers */}
      <div className="mt-3 flex items-start justify-between gap-6 text-[10.5px]">
        <div className="flex-1">
          <p className="font-bold">{type === "credit_note" ? "Credit to:" : "Customer:"}</p>
          <div className="pl-[14mm] font-bold leading-[1.4]">
            <p>{customer?.company_name || customer?.name}</p>
            {customer?.address && <p className="whitespace-pre-line">{customer.address}</p>}
            {customer?.tin && <p className="font-normal">TIN: {customer.tin}</p>}
          </div>
        </div>
        <table className="w-[78mm]"><tbody>
          {facts.map(([k, v]) => (
            <tr key={k}><td className="w-[28mm] pr-3 font-bold">{k}</td><td className={k === "Date:" || k === "PO No:" ? "font-bold" : ""}>{v ?? ""}</td></tr>
          ))}
        </tbody></table>
      </div>

      {/* the work, then the totals, in one ruled table */}
      <table className="mt-2 w-full border-collapse text-[9.5px]">
        <thead>
          <tr className="font-bold">
            <th className={`${cell} w-[17mm] py-1.5`}>Item No.</th>
            <th className={`${cell} py-1.5`}>Description</th>
            <th className={`${cell} w-[13mm] py-1.5`}>Qty</th>
            <th className={`${cell} w-[15mm] py-1.5`}>Unit</th>
            <th className={`${cell} w-[22mm] py-1.5`}>Rate</th>
            <th className={`${cell} w-[25mm] py-1.5`}>Amount ({currency})</th>
          </tr>
        </thead>
        <tbody style={ARIAL}>
          {memo && memo.split("\n").filter((x) => x.trim()).map((m, i) => (
            <tr key={`m${i}`}>
              <td className={cell} />
              <td className={`${cell} text-center ${i === 1 ? "text-[12px] font-bold underline" : i > 1 ? "font-semibold" : ""}`} style={i === 1 ? TIMES : undefined}>{m}</td>
              <td className={cell} /><td className={cell} /><td className={cell} /><td className={cell} />
            </tr>
          ))}
          {memo && <Blank />}
          {lines.map((l, i) => {
            const section = l.heading && isSection(l.itemNo);
            return [
              l.heading && i > 0 && <Blank key={`b${i}`} />,
              <tr key={i} className={section ? "bg-[#c0c0c0]" : ""}>
                <td className={`${cell} text-center ${l.heading ? "font-bold" : ""}`}>{l.itemNo ?? (l.heading ? "" : priced.indexOf(l) + 1)}</td>
                <td className={`${cell} whitespace-pre-line ${l.heading ? "font-bold" : ""}`}>{l.description}</td>
                <td className={`${cell} text-center ${section ? "bg-white" : ""}`}>{l.qty == null ? "" : l.qty}</td>
                <td className={`${cell} text-center ${section ? "bg-white" : ""}`}>{l.unit ?? ""}</td>
                <td className={`${cell} text-right ${section ? "bg-white" : ""}`}>{l.rate == null ? "" : n2(l.rate)}</td>
                <td className={`${cell} text-right ${section ? "bg-white" : ""}`}>{l.heading ? "" : n2(l.amount)}</td>
              </tr>,
            ];
          })}
          {Array.from({ length: fill }, (_, i) => <Blank key={`f${i}`} />)}
        </tbody>
        <tbody className="text-[10.5px]">
          <tr className="font-bold"><td colSpan={5} className={cell}>Sub Total</td><td className={`${cell} text-right font-normal`}>{n2(subtotal)}</td></tr>
          {isInvoice && <>
            <tr><td colSpan={5} className={cell}>Less Advance Payment</td><td className={`${cell} text-right`}>-</td></tr>
            <tr className="font-bold"><td colSpan={5} className={cell}>Less Retention Payment</td><td className={`${cell} text-right font-normal`}>-</td></tr>
          </>}
          <tr className="font-bold"><td colSpan={5} className={cell}>Taxable Amount</td><td className={`${cell} text-right`}>{n2(subtotal)}</td></tr>
          <tr className="font-bold"><td colSpan={5} className={cell}>{gstLabel}</td><td className={`${cell} text-right font-normal`}>{n2(gst)}</td></tr>
          <tr className="font-bold">
            <td colSpan={5} className={cell}>Grand Total:<span className="ml-3">{amountInWords(total, currency)}</span></td>
            <td className={`${cell} text-right`}>{n2(total)}</td>
          </tr>
          {isInvoice && paid > 0n && <>
            <tr><td colSpan={5} className={cell}>Paid</td><td className={`${cell} text-right`}>{n2(paid)}</td></tr>
            <tr className="font-bold"><td colSpan={5} className={cell}>Balance Due</td><td className={`${cell} text-right`}>{n2(balance)}</td></tr>
          </>}
        </tbody>
      </table>

      {/* signed and stamped by us; signed for by them */}
      <div className="mt-10 flex items-start justify-between gap-8 text-[10px]">
        <div>
          <div className="flex items-start gap-2">
            <p className="pt-2 font-bold">Authorized by:</p>
            {(signer?.signatureUrl || signer?.stampUrl) && (
              <div className="relative h-[26mm] w-[52mm]">
                {signer?.signatureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={signer.signatureUrl} alt="Signature" className="absolute bottom-0 left-0 z-10 h-[18mm] w-[32mm] object-contain object-bottom" />
                )}
                {signer?.stampUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={signer.stampUrl} alt="Company stamp" className="absolute right-0 top-0 h-[24mm] w-[24mm] object-contain" />
                )}
              </div>
            )}
          </div>
          <p className={signer?.signatureUrl || signer?.stampUrl ? "" : "mt-12"}>…………………………</p>
          {signer?.name && <p>{signer.name}</p>}
          <p className="font-bold">{signer?.title || "Manager Billing & Collection"}</p>
        </div>
        {isInvoice && (
          <div className="w-[62mm] leading-[1.5]">
            <p className="mb-1 font-bold">Invoice Received by:</p>
            <p>Name:…………………………………</p>
            <p>Designation: ……………………….</p>
            <p>Date: ………………………………</p>
            <p>Signature:…………………………..</p>
          </div>
        )}
      </div>

      {/* the terms, and room to sign for the payment */}
      <div className="mt-6 flex border border-black text-[8.5px] leading-[1.45]">
        <div className="flex-1 px-1.5 py-1">
          <p className="font-bold underline">Terms:</p>
          {termLines.length > 0
            ? termLines.map((t, i) => <p key={i} className={`font-bold ${/no cash/i.test(t) ? "text-red-600" : ""}`}>{/^\d/.test(t) ? t : `${i + 1}- ${t}`}</p>)
            : company.bank_details && <p className="whitespace-pre-line font-bold">All transfers should be made to {company.bank_details}</p>}
        </div>
        {isInvoice && (
          <div className="w-[62mm] border-l border-black px-1.5 py-1 leading-[2]">
            <p className="font-bold leading-[1.45]">Payment Received by:</p>
            <p className="mt-2">Name: ………………………………</p>
            <p>Date: ………………………………</p>
            <p>Stamp &amp; Signature:…………………</p>
          </div>
        )}
      </div>

      <p className="mt-auto pt-6 text-center text-[7px]" style={ARIAL}>{footer || companyLine}</p>
    </div>
  );
}
