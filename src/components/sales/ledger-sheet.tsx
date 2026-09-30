import type { ReactNode } from "react";

/** The company block every printed ledger document carries. */
export type Company = {
  legal_name: string; trade_name: string | null; tin: string | null; gst_registered: boolean;
  taxable_activity_no: string | null; address: string | null; phone: string | null; email: string | null; bank_details: string | null;
};

const ACCENT = "#0b1f3a";

/** An A4 sheet with our header: title on the right, company and tax registration on the left. */
export function LedgerSheet({ company, title, number, children }: { company: Company; title: string; number?: string | null; children: ReactNode }) {
  return (
    <div className="doc-sheet mx-auto flex min-h-[297mm] w-[210mm] max-w-full flex-col bg-white px-[16mm] pb-[12mm] pt-[14mm] font-[family-name:var(--font-poppins)] text-[10.5px] leading-snug text-[#1b2330] shadow-[0_2px_18px_rgba(13,27,42,0.12)]">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" className="h-[60px] w-[60px] object-contain" />
          <div>
            <p className="text-[14px] font-bold" style={{ color: ACCENT }}>{company.trade_name || company.legal_name}</p>
            {company.trade_name && company.trade_name !== company.legal_name && <p className="text-[9px]">{company.legal_name}</p>}
            {company.address && <p className="whitespace-pre-line text-[9.5px]">{company.address}</p>}
            <p className="text-[9.5px]">{[company.phone, company.email].filter(Boolean).join(" · ")}</p>
            {company.tin && <p className="text-[9.5px]">TIN {company.tin}</p>}
            {company.gst_registered && company.taxable_activity_no && <p className="text-[9.5px]">GST registration {company.taxable_activity_no}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[28px] leading-none tracking-wide" style={{ color: ACCENT }}>{title}</p>
          {number && <p className="mt-1 text-[11px] font-semibold">No. {number}</p>}
        </div>
      </div>
      <div className="mt-8 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

export const sheetTh = "px-2 py-2.5 text-left font-semibold text-white";
export const sheetAccent = ACCENT;
