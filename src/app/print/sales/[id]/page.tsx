import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { PrintToolbar } from "../../toolbar";
import { LedgerSheet, sheetAccent, sheetTh, type Company } from "@/components/sales/ledger-sheet";
import { dbToLaari, laariToNumber } from "@/lib/money";

export const dynamic = "force-dynamic";

const n2 = (v: bigint) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(laariToNumber(v));
const d = (s: string | null | undefined) => s ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`)) : "";
const TITLE: Record<string, string> = { invoice: "TAX INVOICE", credit_note: "CREDIT NOTE", sales_receipt: "SALES RECEIPT" };

/** A tax invoice, credit note or sales receipt as the customer sees it (§8 tax-invoice details). */
export default async function PrintSalesDoc({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ data: doc }, { data: lines }, { data: company }] = await Promise.all([
    s.supabase.from("sales_list_v").select("*").eq("id", id).maybeSingle(),
    s.supabase.from("transaction_lines").select("description, qty, rate, amount, tax_amount, tax_codes(code, name)").eq("transaction_id", id).order("line_no"),
    s.supabase.from("company").select("legal_name, trade_name, tin, gst_registered, taxable_activity_no, address, phone, email, bank_details").eq("id", true).maybeSingle(),
  ]);
  if (!doc || !TITLE[doc.type] || !company) notFound();
  const [{ data: t }, { data: cust }] = await Promise.all([
    s.supabase.from("transactions").select("memo, reference, currency").eq("id", id).maybeSingle(),
    s.supabase.from("contacts").select("name, company_name, address, tin, gst_registered, taxable_activity_no").eq("id", doc.contact_id).maybeSingle(),
  ]);
  const subtotal = (lines ?? []).reduce((a, l) => a + dbToLaari(l.amount), 0n);
  const gst = (lines ?? []).reduce((a, l) => a + dbToLaari(l.tax_amount), 0n);
  const cur = t?.currency ?? "MVR";
  const title = doc.type === "invoice" && !(company as Company).gst_registered ? "INVOICE" : TITLE[doc.type];

  return (
    <>
      <title>{doc.number ?? title}</title>
      <PrintToolbar back={`/sales/${id}`} filename={`${(doc.number ?? title).replace(/[\\/]+/g, "-")}`} />
      <LedgerSheet company={company as Company} title={title} number={doc.number}>
        {doc.voided_at && <p className="mb-4 rounded border border-red-400 px-3 py-2 text-center text-[12px] font-bold text-red-700">VOID — this document has been cancelled</p>}
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[9px] uppercase tracking-wide text-[#5b6675]">{doc.type === "credit_note" ? "Credit to" : "Bill to"}</p>
            <p className="mt-1 text-[11px] font-semibold">{cust?.company_name || cust?.name}</p>
            {cust?.address && <p className="whitespace-pre-line text-[9.5px]">{cust.address}</p>}
            {cust?.tin && <p className="text-[9.5px]">TIN {cust.tin}</p>}
            {cust?.gst_registered && cust.taxable_activity_no && <p className="text-[9.5px]">GST registration {cust.taxable_activity_no}</p>}
          </div>
          <table className="text-[10.5px]"><tbody>
            <tr><td className="pr-6 text-right text-[#5b6675]">Date</td><td className="text-right">{d(doc.date)}</td></tr>
            {doc.type === "invoice" && <tr><td className="pr-6 text-right text-[#5b6675]">Due</td><td className="text-right">{d(doc.due_date)}</td></tr>}
            {doc.project_code && <tr><td className="pr-6 text-right text-[#5b6675]">Project</td><td className="text-right">{doc.project_code}</td></tr>}
            {t?.reference && <tr><td className="pr-6 text-right text-[#5b6675]">Your ref.</td><td className="text-right">{t.reference}</td></tr>}
          </tbody></table>
        </div>

        <table className="mt-6 w-full border-collapse text-[9.5px]">
          <thead><tr style={{ background: sheetAccent }}>
            <th className={`${sheetTh} w-8`}>#</th><th className={sheetTh}>Description</th>
            <th className={`${sheetTh} w-14 text-right`}>Qty</th><th className={`${sheetTh} w-20 text-right`}>Rate</th>
            <th className={`${sheetTh} w-24 text-right`}>Amount</th><th className={`${sheetTh} w-20 text-right`}>GST</th>
          </tr></thead>
          <tbody>
            {(lines ?? []).map((l, i) => {
              const tc = l.tax_codes as unknown as { code: string; name: string } | null;
              return (
                <tr key={i} className="border-b border-[#c9ced6] align-top">
                  <td className="px-2 py-2">{i + 1}</td>
                  <td className="whitespace-pre-line px-2 py-2">{l.description}</td>
                  <td className="px-2 py-2 text-right">{l.qty == null ? "" : Number(l.qty)}</td>
                  <td className="px-2 py-2 text-right">{l.rate == null ? "" : n2(dbToLaari(l.rate))}</td>
                  <td className="px-2 py-2 text-right">{n2(dbToLaari(l.amount))}</td>
                  <td className="px-2 py-2 text-right">{n2(dbToLaari(l.tax_amount))}<span className="block text-[8px] text-[#5b6675]">{tc?.name ?? ""}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <table className="text-[10.5px]"><tbody>
            <tr><td className="py-0.5 pr-8 text-right text-[#5b6675]">Subtotal</td><td className="text-right">{n2(subtotal)}</td></tr>
            <tr><td className="py-0.5 pr-8 text-right text-[#5b6675]">GST</td><td className="text-right">{n2(gst)}</td></tr>
            <tr className="font-bold"><td className="py-1 pr-8 text-right">Total {cur}</td><td className="text-right">{n2(subtotal + gst)}</td></tr>
            {doc.type === "invoice" && dbToLaari(doc.applied) > 0n && <>
              <tr><td className="py-0.5 pr-8 text-right text-[#5b6675]">Paid</td><td className="text-right">{n2(dbToLaari(doc.applied))}</td></tr>
              <tr className="font-bold"><td className="py-1 pr-8 text-right">Balance due</td><td className="text-right">{n2(dbToLaari(doc.balance))}</td></tr>
            </>}
          </tbody></table>
        </div>

        {t?.memo && <p className="mt-6 whitespace-pre-line text-[10px]">{t.memo}</p>}
        <div className="mt-auto pt-8 text-[9.5px]">
          {doc.type === "invoice" && company.bank_details && <><p className="font-semibold">Please pay to</p><p className="whitespace-pre-line">{company.bank_details}</p></>}
        </div>
      </LedgerSheet>
    </>
  );
}
