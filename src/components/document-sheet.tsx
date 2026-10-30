import type { DocLine, TemplateBody, TemplateHeader, TemplateTail } from "@/lib/documents";
import { round2 } from "@/lib/documents";
import { amountInWords } from "@/lib/words";
import type { Company } from "@/components/sales/ledger-sheet";

const n2 = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const shortDate = (d: string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
        .format(new Date(`${d}T00:00:00Z`))
    : "";

export interface SheetData {
  kind: "quotation" | "invoice";
  number: string;
  /** on an invoice, the quotation it was raised from */
  quotationNumber?: string | null;
  date: string | null;
  /** valid until, on a quotation; due by, on an invoice */
  untilDate?: string | null;
  /** how long the job takes — 13 days */
  duration?: string | null;
  toName: string;
  toDetails?: string | null;
  title?: string | null;
  lines: DocLine[];
  taxRate: number;
  terms: string;
  /** e.g. "30%" — printed beside the amount column when an invoice charges part of the quote */
  portionLabel?: string | null;
}

/**
 * A quotation or invoice as the client sees it, on an A4 sheet, laid out the
 * way Spruce & Co's quotations already look. It is plain markup with no
 * state, so the same sheet serves the preview, the template editor and the
 * printed copy.
 */
export function DocumentSheet({
  header,
  body,
  tail,
  data,
  signer,
  company,
}: {
  header: TemplateHeader;
  body: TemplateBody;
  tail: TemplateTail;
  data: SheetData;
  /** who signs, their signature, and the stamp if this document carries it */
  signer?: { name: string; title: string | null; signatureUrl: string | null; stampUrl: string | null };
  /** the company's details from Settings: TIN and the footer line, when the template leaves them out */
  company?: Company | null;
}) {
  if (header.layout === "boxed") return <BoxedSheet header={header} body={body} tail={tail} data={data} signer={signer} company={company} />;
  const stampUrl = signer?.stampUrl ?? null;
  const signatureUrl = signer?.signatureUrl ?? null;
  const signName = signer ? signer.name : tail.signatory_name;
  const signTitle = signer ? signer.title : tail.signatory_title;
  const subtotal = round2(data.lines.reduce((s, l) => s + l.amount, 0));
  const tax = round2((subtotal * data.taxRate) / 100);
  const total = round2(subtotal + tax);
  const terms = (data.terms ?? "").split("\n").map((t) => t.trim()).filter(Boolean);
  const accent = header.accent || "#0b1f3a";
  const cols = body.show_unit ? 6 : 5;

  const facts: [string, string][] = [
    [data.kind === "invoice" ? "Invoice Date :" : "Quote Date :", shortDate(data.date)],
  ];
  if (data.kind === "invoice" && data.quotationNumber) facts.push(["Quote# :", data.quotationNumber]);
  if (data.untilDate) facts.push([data.kind === "invoice" ? "Due Date :" : "Valid Until :", shortDate(data.untilDate)]);
  if (body.show_duration && data.duration) facts.push(["Duration :", data.duration]);

  return (
    <div className="doc-sheet mx-auto flex min-h-[297mm] w-[210mm] max-w-full flex-col bg-white px-[calc(14mm+10px)] pb-[12mm] pt-[calc(12mm+10px)] font-[family-name:var(--font-poppins)] text-[10.5px] leading-snug text-[#1b2330] shadow-[0_2px_18px_rgba(13,27,42,0.12)]">
      {/* header: our mark on the left, what this is on the right */}
      <div className="flex items-start justify-between gap-6">
        <div className="w-40 text-center">
          {header.show_logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/logo-mark.png" alt="" className="mx-auto h-[68px] w-[68px] object-contain" />
          )}
          <p className="mt-1 font-[family-name:var(--font-fallback-serif)] text-[14px] font-bold leading-none"
            style={{ color: accent }}>
            {header.company_name}
          </p>
          {header.company_sub && <p className="mt-0.5 text-[8px] tracking-wide">{header.company_sub}</p>}
        </div>
        <div className="text-right">
          <p className="text-[34px] font-normal leading-none tracking-wide" style={{ color: accent }}>
            {header.title}
          </p>
          <p className="mt-1 text-[11px] font-semibold">
            {header.number_label} {data.number}
          </p>
        </div>
      </div>

      <div className="mt-6 pl-[3mm] text-[11.5px] leading-[1.35]">
        {header.address && <p className="whitespace-pre-line">{header.address}</p>}
        {header.tin && <p>TIN: {header.tin}</p>}
      </div>

      {/* who it is for, and the dates */}
      <div className="mt-8 flex items-end justify-between gap-6">
        <div>
          <p className="text-[12px]">{body.to_label}</p>
          <p className="mt-1 text-[9.5px] font-semibold">{data.toName}</p>
          {data.toDetails && <p className="whitespace-pre-line text-[9.5px]">{data.toDetails}</p>}
        </div>
        <table className="text-[12px]">
          <tbody>
            {facts.map(([k, v]) => (
              <tr key={k}>
                <td className="py-1 pr-10 text-right">{k}</td>
                <td className="py-1 text-right text-[11px]">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {body.intro && <p className="mt-4 whitespace-pre-line">{body.intro}</p>}

      {/* the work */}
      <table className="mt-5 w-full border-collapse text-[9px]">
        <thead>
          <tr className="text-white" style={{ background: accent }}>
            <th className="w-12 py-3 font-semibold">#</th>
            <th className="border-l border-white/30 px-2 py-3 text-left font-semibold">{body.col_description}</th>
            {body.show_unit && <th className="w-16 border-l border-white/30 py-3 font-semibold">{body.col_unit}</th>}
            <th className="w-16 border-l border-white/30 px-2 py-3 text-right font-semibold">{body.col_qty}</th>
            <th className="w-[74px] border-l border-white/30 px-2 py-3 text-right font-semibold">{body.col_rate}</th>
            <th className="w-[100px] border-l border-white/30 px-2 py-3 text-right font-semibold">
              {body.col_total}
              {data.portionLabel ? ` ${data.portionLabel}` : ""}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.title && (
            <tr className="[&>td]:border-b [&>td]:border-[#c9ced6]">
              <td />
              <td colSpan={cols - 1} className="px-2 py-2.5 font-semibold">{data.title}</td>
            </tr>
          )}
          {data.lines.length === 0 && (
            <tr className="[&>td]:border-b [&>td]:border-[#c9ced6]">
              <td colSpan={cols} className="py-6 text-center text-[#8a93a0]">No lines yet</td>
            </tr>
          )}
          {data.lines.map((l, i) => (
            <tr key={i} className="align-top [&>td]:border-b [&>td]:border-[#c9ced6]">
              <td className="py-3 text-center">{i + 1}</td>
              <td className="px-2 py-3">
                {l.title}
                {l.title && l.description ? " _ " : ""}
                {l.description && <span className="whitespace-pre-line">{l.description}</span>}
              </td>
              {body.show_unit && <td className="py-3 text-center">{l.unit}</td>}
              <td className="px-2 py-3 text-right">{n2(l.qty)}</td>
              <td className="px-2 py-3 text-right">{n2(l.rate)}</td>
              <td className="px-2 py-3 text-right">{n2(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ml-auto mt-3 w-[62mm] text-[11px]">
        <div className="flex justify-between px-3 py-1">
          <span>Sub Total</span>
          <span>{n2(subtotal)}</span>
        </div>
        {data.taxRate > 0 && (
          <div className="flex justify-between px-3 py-1">
            <span>{body.tax_label} ({data.taxRate}%)</span>
            <span>{n2(tax)}</span>
          </div>
        )}
        <div className="mt-2 flex justify-between px-3 py-3 text-[9.5px] font-semibold text-white"
          style={{ background: accent }}>
          <span className="w-1/2 text-right">Total</span>
          <span>MVR{n2(total)}</span>
        </div>
      </div>

      {/* the tail */}
      {(terms.length > 0 || tail.closing_note) && (
        <div className="mt-10 text-[8.5px] leading-[1.45]">
          {terms.length > 0 && (
            <>
              <p className="mb-0.5 text-[12px]">Terms &amp; Conditions</p>
              {terms.map((t, i) => (
                <p key={i}>- {t}</p>
              ))}
            </>
          )}
          {tail.closing_note && <p className="mt-3 whitespace-pre-line">{tail.closing_note}</p>}
        </div>
      )}

      {tail.bank_details && (
        <div className="mt-3 text-[8.5px]">
          <p className="font-semibold">Bank details</p>
          <p className="whitespace-pre-line">{tail.bank_details}</p>
        </div>
      )}

      <div className="mt-6 flex items-end justify-between gap-6">
        {/* signature centred over the name, the stamp overlapping it up to the right */}
        <div className="pl-[6mm]">
          {(stampUrl || signatureUrl) && (
            <div className="relative h-[36mm] w-[58mm]">
              {signatureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={signatureUrl} alt="Signature"
                  className="absolute bottom-0 left-0 z-10 h-[20mm] w-[40mm] object-contain object-bottom" />
              )}
              {stampUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={stampUrl} alt="Company stamp"
                  className="absolute right-0 top-0 h-[30mm] w-[30mm] object-contain" />
              )}
            </div>
          )}
          <div className="w-[40mm] text-center text-[11.5px] leading-tight">
            {signName && <p>{signName}</p>}
            {signTitle && <p>{signTitle}</p>}
          </div>
        </div>
        {tail.show_client_signature && (
          <div className="w-56 text-[10px]">
            <p className="border-b border-dotted border-[#8a93a0] pb-8 text-center text-[#8a93a0]">Signature</p>
            <p className="mt-1 text-center">On Behalf of the Client</p>
            <p className="mt-1 font-semibold">Name:</p>
            <p className="font-semibold">ID:</p>
          </div>
        )}
      </div>

      {tail.footer_text && (
        <div className="mt-auto pt-6">
          <p className="py-3 text-center text-[8.5px] text-white/85" style={{ background: accent }}>
            {tail.footer_text}
          </p>
        </div>
      )}
    </div>
  );
}

/** the boxed page is set in Times, ruled in black, as tender quotations are */
const TIMES = { fontFamily: '"Times New Roman", Times, "Liberation Serif", serif' };
// the site-wide border colour would turn the rules grey, so black is forced
const ruled = "border border-black! px-1.5 py-[2px] align-middle";
const dotted = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "");
const qtyText = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The ruled page: our name and address by the mark, the title in the middle,
 * the customer and the quotation's numbers, the work in one grid with the
 * totals and the amount in words, then signatures, the customer's
 * confirmation box and the conditions.
 */
function BoxedSheet({ header, body, tail, data, signer, company }: {
  header: TemplateHeader; body: TemplateBody; tail: TemplateTail; data: SheetData;
  signer?: { name: string; title: string | null; signatureUrl: string | null; stampUrl: string | null };
  company?: Company | null;
}) {
  const subtotal = round2(data.lines.reduce((s, l) => s + l.amount, 0));
  const tax = round2((subtotal * data.taxRate) / 100);
  const total = round2(subtotal + tax);
  const terms = (data.terms ?? "").split("\n").map((t) => t.trim()).filter(Boolean);
  const isQuote = data.kind === "quotation";
  const cols = body.show_unit ? 6 : 5;
  const signName = signer ? signer.name : tail.signatory_name;
  const signTitle = signer ? signer.title : tail.signatory_title;
  const name = [header.company_name, header.company_sub].filter(Boolean).join(" ") || company?.legal_name || "";
  const tin = header.tin || company?.tin;
  const footer = tail.footer_text || [company?.address?.replace(/\s*\n\s*/g, ", "), company?.registration_no && `Reg No: ${company.registration_no}`,
    company?.phone && `T: ${company.phone}`, company?.email && `E: ${company.email}`].filter(Boolean).join(" | ");

  const facts: [string, string][] = [["Date:", dotted(data.date)], [isQuote ? "Quotation No:" : "Invoice No:", data.number]];
  if (!isQuote && data.quotationNumber) facts.push(["Quotation No:", data.quotationNumber]);
  if (isQuote) facts.push(["Quotation Validity:", data.date && data.untilDate ? `${days(data.date, data.untilDate)} Days` : ""]);
  else if (data.untilDate) facts.push(["Due Date:", dotted(data.untilDate)]);
  if (isQuote || body.show_duration) facts.push(["Duration of the Work:", data.duration ?? ""]);

  const blank = (key: string) => <tr key={key}>{Array.from({ length: cols }, (_, i) => <td key={i} className={`${ruled} h-[15px]`} />)}</tr>;
  // empty rows keep the grid the height of a page, as the paper one is
  const fill = Math.max(0, 20 - data.lines.length - (data.title ? 3 : 0) - Math.ceil(terms.length / 2));

  return (
    <div className="doc-sheet mx-auto flex min-h-[297mm] w-[210mm] max-w-full flex-col bg-white px-[14mm] pb-[10mm] pt-[12mm] text-[10.5px] leading-snug text-black shadow-[0_2px_18px_rgba(13,27,42,0.12)]" style={TIMES}>
      <div className="flex items-start gap-3">
        {header.show_logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/logo-mark.png" alt="" className="h-[56px] w-[56px] object-contain" />
        )}
        <div className="text-[9.5px] leading-[1.35]">
          <p className="text-[11px] font-bold uppercase">{name}</p>
          {(header.address || company?.address) && <p className="whitespace-pre-line">{header.address || company?.address}</p>}
        </div>
      </div>

      <div className="mt-1 text-center">
        <p className="text-[15px] font-bold uppercase tracking-wide underline">{header.title}</p>
        {tin && <p className="text-[8.5px] font-bold">TIN: {tin}</p>}
      </div>

      <div className="mt-3 flex items-start justify-between gap-6">
        <div className="flex-1">
          <p className="font-bold">{body.to_label}</p>
          <div className="pl-[14mm] leading-[1.4]">
            <p className="text-[12px] font-bold">{data.toName}</p>
            {data.toDetails && <p className="whitespace-pre-line">{data.toDetails}</p>}
          </div>
        </div>
        <table className="w-[78mm]"><tbody>
          {facts.map(([k, v]) => (
            <tr key={k}><td className="w-[32mm] pr-3 font-bold">{k}</td><td className={k === "Date:" ? "font-bold" : ""}>{v}</td></tr>
          ))}
        </tbody></table>
      </div>

      {body.intro && <p className="mt-3 whitespace-pre-line">{body.intro}</p>}

      <table className="mt-2 w-full border-collapse text-[9.5px]">
        <thead>
          <tr className="font-bold">
            <th className={`${ruled} w-[17mm] py-1.5`}>Job No.</th>
            <th className={`${ruled} py-1.5`}>{body.col_description}</th>
            <th className={`${ruled} w-[13mm] py-1.5`}>{body.col_qty}</th>
            {body.show_unit && <th className={`${ruled} w-[15mm] py-1.5`}>{body.col_unit}</th>}
            <th className={`${ruled} w-[22mm] py-1.5`}>{body.col_rate}</th>
            <th className={`${ruled} w-[25mm] py-1.5`}>{body.col_total}{data.portionLabel ? ` ${data.portionLabel}` : ""}</th>
          </tr>
        </thead>
        <tbody>
          {data.title && [
            blank("t0"),
            <tr key="t1">
              <td className={ruled} />
              <td className={`${ruled} text-center font-bold`}>{data.title}</td>
              {Array.from({ length: cols - 2 }, (_, i) => <td key={i} className={ruled} />)}
            </tr>,
            blank("t2"),
          ]}
          {data.lines.map((l, i) => (
            <tr key={i}>
              <td className={`${ruled} text-center`}>{i + 1}</td>
              <td className={`${ruled} whitespace-pre-line`}>
                {l.title}{l.title && l.description ? " _ " : ""}{l.description}
              </td>
              <td className={`${ruled} text-center`}>{qtyText(l.qty)}</td>
              {body.show_unit && <td className={`${ruled} text-center`}>{l.unit}</td>}
              <td className={`${ruled} text-right`}>{n2(l.rate)}</td>
              <td className={`${ruled} text-right`}>{n2(l.amount)}</td>
            </tr>
          ))}
          {Array.from({ length: fill }, (_, i) => blank(`f${i}`))}
        </tbody>
        <tbody className="text-[10.5px] font-bold">
          <tr><td colSpan={cols - 1} className={ruled}>Sub Total :</td><td className={`${ruled} text-right`}>{n2(subtotal)}</td></tr>
          <tr><td colSpan={cols - 1} className={ruled}>Discount :</td><td className={`${ruled} text-right`}>-</td></tr>
          <tr><td colSpan={cols - 1} className={ruled}>Taxable Amount :</td><td className={`${ruled} text-right`}>{n2(subtotal)}</td></tr>
          <tr><td colSpan={cols - 1} className={ruled}>{body.tax_label} {data.taxRate}% :</td><td className={`${ruled} text-right`}>{tax ? n2(tax) : "-"}</td></tr>
          <tr className="text-[11.5px]">
            <td colSpan={cols - 1} className={`${ruled} py-1.5`}>Grand Total:<span className="ml-3">{amountInWords(BigInt(Math.round(total * 100)))}</span></td>
            <td className={`${ruled} text-right`}>{n2(total)}</td>
          </tr>
        </tbody>
      </table>

      {/* signed and stamped by us; received by them */}
      <div className="mt-8 flex items-start justify-between gap-8 text-[10px]">
        <div>
          <p className="font-bold">Authorized by:</p>
          {(signer?.signatureUrl || signer?.stampUrl) && (
            <div className="relative h-[26mm] w-[60mm]">
              {signer?.signatureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={signer.signatureUrl} alt="Signature" className="absolute bottom-0 left-0 z-10 h-[18mm] w-[32mm] object-contain object-bottom object-left" />
              )}
              {signer?.stampUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={signer.stampUrl} alt="Company stamp" className="absolute left-[28mm] top-0 h-[24mm] w-[24mm] object-contain" />
              )}
            </div>
          )}
          <p className={signer?.signatureUrl || signer?.stampUrl ? "" : "mt-12"}>…………………………</p>
          {signName && <p>{signName}</p>}
          {signTitle && <p className="font-bold">{signTitle}</p>}
        </div>
        {tail.show_client_signature && (
          <div className="w-[62mm] leading-[1.6]">
            <p className="mb-4 font-bold">{isQuote ? "Quotation" : "Invoice"} Received by:</p>
            <p>Name:…………………………………</p>
            <p>Designation: ……………………….</p>
            <p>Date: ………………………………</p>
            <p>Signature:…………………………..</p>
          </div>
        )}
      </div>

      {tail.show_client_signature && isQuote && (
        <table className="mt-5 w-full border-collapse text-[9.5px]">
          <thead>
            <tr className="font-bold">
              <th className={`${ruled} text-left`}>For use of Customer Only (Confirmation)</th>
              <th className={`${ruled} w-[45%]`}>Seal/Stamp of the Customer</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={`${ruled} align-top font-bold leading-[1.5]`}><p>Name:</p><p>Designation:</p><p>Date:</p><p>Signature:</p></td>
              <td className={`${ruled} align-bottom`}><p className="mx-auto mb-2 w-[45mm] border-b border-dashed border-black!" /></td>
            </tr>
          </tbody>
        </table>
      )}

      {(terms.length > 0 || tail.closing_note || tail.bank_details) && (
        <div className="mt-3 text-[9px] leading-[1.45]">
          {terms.length > 0 && (
            <>
              <p className="font-bold">Conditions:</p>
              <ul className="pl-[14mm]">{terms.map((t, i) => <li key={i}>* {t}</li>)}</ul>
            </>
          )}
          {tail.closing_note && <p className="mt-2 whitespace-pre-line">{tail.closing_note}</p>}
          {tail.bank_details && <p className="mt-2 whitespace-pre-line"><span className="font-bold">Bank details: </span>{tail.bank_details}</p>}
        </div>
      )}

      {footer && <div className="mt-auto pt-4"><p className="border-t border-black! pt-1 text-center text-[7.5px]">{footer}</p></div>}
    </div>
  );
}
