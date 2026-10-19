import { LedgerSheet, sheetAccent, sheetTh, type Company } from "./ledger-sheet";
import { laariToNumber } from "@/lib/money";

export type SheetCustomer = {
  name: string; company_name: string | null; address: string | null; tin: string | null;
  gst_registered: boolean | null; taxable_activity_no: string | null;
};
export type SheetLine = { description: string; qty: number | null; rate: bigint | null; amount: bigint; tax: bigint; taxName: string };
export type SheetSigner = { name: string | null; title: string | null; signatureUrl: string | null; stampUrl: string | null };

const n2 = (v: bigint) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(laariToNumber(v));
const d = (s: string | null | undefined) => s ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`)) : "";
const TITLE: Record<string, string> = { invoice: "TAX INVOICE", credit_note: "CREDIT NOTE", sales_receipt: "SALES RECEIPT" };

export const sheetTitle = (type: string, company: Company) =>
  type === "invoice" && !company.gst_registered ? "INVOICE" : TITLE[type];

/**
 * A tax invoice, credit note or sales receipt as the customer sees it (§8
 * tax-invoice details): the printed page, and the live preview beside the form.
 */
export function SalesSheet({ type, company, number, voided = false, customer, date, due, projectCode, reference, lines, currency, paid = 0n, balance = 0n, memo, signer }: {
  type: string; company: Company; number: string | null; voided?: boolean; customer: SheetCustomer | null;
  date: string; due: string | null; projectCode: string | null; reference: string | null; lines: SheetLine[];
  currency: string; paid?: bigint; balance?: bigint; memo: string | null; signer: SheetSigner | null;
}) {
  const subtotal = lines.reduce((a, l) => a + l.amount, 0n);
  const gst = lines.reduce((a, l) => a + l.tax, 0n);
  return (
    <LedgerSheet company={company} title={sheetTitle(type, company)} number={number}>
      {voided && <p className="mb-4 rounded border border-red-400 px-3 py-2 text-center text-[12px] font-bold text-red-700">VOID — this document has been cancelled</p>}
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-[#5b6675]">{type === "credit_note" ? "Credit to" : "Bill to"}</p>
          <p className="mt-1 text-[11px] font-semibold">{customer?.company_name || customer?.name}</p>
          {customer?.address && <p className="whitespace-pre-line text-[9.5px]">{customer.address}</p>}
          {customer?.tin && <p className="text-[9.5px]">TIN {customer.tin}</p>}
          {customer?.gst_registered && customer.taxable_activity_no && <p className="text-[9.5px]">GST registration {customer.taxable_activity_no}</p>}
        </div>
        <table className="text-[10.5px]"><tbody>
          <tr><td className="pr-6 text-right text-[#5b6675]">Date</td><td className="text-right">{d(date)}</td></tr>
          {type === "invoice" && <tr><td className="pr-6 text-right text-[#5b6675]">Due</td><td className="text-right">{d(due)}</td></tr>}
          {projectCode && <tr><td className="pr-6 text-right text-[#5b6675]">Project</td><td className="text-right">{projectCode}</td></tr>}
          {reference && <tr><td className="pr-6 text-right text-[#5b6675]">Your ref.</td><td className="text-right">{reference}</td></tr>}
        </tbody></table>
      </div>

      <table className="mt-6 w-full border-collapse text-[9.5px]">
        <thead><tr style={{ background: sheetAccent }}>
          <th className={`${sheetTh} w-8`}>#</th><th className={sheetTh}>Description</th>
          <th className={`${sheetTh} w-14 text-right`}>Qty</th><th className={`${sheetTh} w-20 text-right`}>Rate</th>
          <th className={`${sheetTh} w-24 text-right`}>Amount</th><th className={`${sheetTh} w-20 text-right`}>GST</th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-[#c9ced6] align-top">
              <td className="px-2 py-2">{i + 1}</td>
              <td className="whitespace-pre-line px-2 py-2">{l.description}</td>
              <td className="px-2 py-2 text-right">{l.qty == null ? "" : l.qty}</td>
              <td className="px-2 py-2 text-right">{l.rate == null ? "" : n2(l.rate)}</td>
              <td className="px-2 py-2 text-right">{n2(l.amount)}</td>
              <td className="px-2 py-2 text-right">{n2(l.tax)}<span className="block text-[8px] text-[#5b6675]">{l.taxName}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <table className="text-[10.5px]"><tbody>
          <tr><td className="py-0.5 pr-8 text-right text-[#5b6675]">Subtotal</td><td className="text-right">{n2(subtotal)}</td></tr>
          <tr><td className="py-0.5 pr-8 text-right text-[#5b6675]">GST</td><td className="text-right">{n2(gst)}</td></tr>
          <tr className="font-bold"><td className="py-1 pr-8 text-right">Total {currency}</td><td className="text-right">{n2(subtotal + gst)}</td></tr>
          {type === "invoice" && paid > 0n && <>
            <tr><td className="py-0.5 pr-8 text-right text-[#5b6675]">Paid</td><td className="text-right">{n2(paid)}</td></tr>
            <tr className="font-bold"><td className="py-1 pr-8 text-right">Balance due</td><td className="text-right">{n2(balance)}</td></tr>
          </>}
        </tbody></table>
      </div>

      {memo && <p className="mt-6 whitespace-pre-line text-[10px]">{memo}</p>}
      <div className="mt-auto flex items-end justify-between gap-6 pt-8 text-[9.5px]">
        <div>
          {type === "invoice" && company.bank_details && <><p className="font-semibold">Please pay to</p><p className="whitespace-pre-line">{company.bank_details}</p></>}
        </div>
        {signer && (signer.name || signer.signatureUrl || signer.stampUrl) && (
          <div>
            {/* signature centred over the name, the stamp overlapping it up to the right, as on quotations */}
            {(signer.stampUrl || signer.signatureUrl) && (
              <div className="relative h-[30mm] w-[50mm]">
                {signer.signatureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={signer.signatureUrl} alt="Signature" className="absolute bottom-0 left-0 z-10 h-[18mm] w-[36mm] object-contain object-bottom" />
                )}
                {signer.stampUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={signer.stampUrl} alt="Company stamp" className="absolute right-0 top-0 h-[26mm] w-[26mm] object-contain" />
                )}
              </div>
            )}
            <div className="w-[36mm] text-center text-[10.5px] leading-tight">
              {signer.name && <p>{signer.name}</p>}
              {signer.title && <p>{signer.title}</p>}
            </div>
          </div>
        )}
      </div>
    </LedgerSheet>
  );
}
