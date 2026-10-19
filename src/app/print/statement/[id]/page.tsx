import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { PrintToolbar } from "../../toolbar";
import { LedgerSheet, sheetAccent, sheetTh, type Company } from "@/components/sales/ledger-sheet";
import { dbToLaari, laariToNumber } from "@/lib/money";
import { today } from "@/lib/format";

export const dynamic = "force-dynamic";
const n2 = (v: bigint) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(laariToNumber(v));
const d = (s: string | null | undefined) => s ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`)) : "";
const label = (t: string | null) => (t ? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "");
type Row = { line_date: string; type: string | null; number: string | null; memo: string | null; due_date: string | null; amount: number | null; balance: number };

/** A customer's statement as a PDF (§ Sales): balance brought forward, each document, balance due. */
export default async function PrintStatement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ id }, { from, to }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ok = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const end = ok(to) ? to! : today();
  const start = ok(from) ? from! : `${end.slice(0, 4)}-01-01`;
  const [{ data: c }, { data: company }, { data, error }] = await Promise.all([
    s.supabase.from("contacts").select("name, company_name, address, tin, kinds").eq("id", id).maybeSingle(),
    s.supabase.from("company").select("legal_name, trade_name, tin, gst_registered, taxable_activity_no, address, phone, email, bank_details").eq("id", true).maybeSingle(),
    s.supabase.rpc("contact_statement", { p_contact: id, p_side: "customer", p_from: start, p_to: end }),
  ]);
  if (!c || !company || error) notFound();
  const rows = (data ?? []) as Row[];
  const closing = dbToLaari(rows.at(-1)?.balance ?? 0);
  return (
    <>
      <title>{`Statement ${c.name}`}</title>
      <PrintToolbar back={`/sales/customers/${id}?tab=statement&from=${start}&to=${end}`} filename={`Statement ${c.name} ${end}`} />
      <LedgerSheet company={company as Company} title="STATEMENT">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[9px] uppercase tracking-wide text-[#5b6675]">To</p>
            <p className="mt-1 text-[11px] font-semibold">{c.company_name || c.name}</p>
            {c.address && <p className="whitespace-pre-line text-[9.5px]">{c.address}</p>}
            {c.tin && <p className="text-[9.5px]">TIN {c.tin}</p>}
          </div>
          <p className="text-right text-[10.5px]">{d(start)} to {d(end)}</p>
        </div>
        <table className="mt-6 w-full border-collapse text-[9.5px]">
          <thead><tr style={{ background: sheetAccent }}>
            <th className={sheetTh}>Date</th><th className={sheetTh}>Document</th><th className={sheetTh}>Due</th>
            <th className={`${sheetTh} text-right`}>Amount</th><th className={`${sheetTh} text-right`}>Balance</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[#c9ced6]">
                <td className="px-2 py-2">{d(r.line_date)}</td>
                <td className="px-2 py-2">{r.type ? `${label(r.type)} ${r.number ?? ""}` : r.memo}</td>
                <td className="px-2 py-2">{r.type === "invoice" ? d(r.due_date) : ""}</td>
                <td className="px-2 py-2 text-right">{r.amount === null ? "" : n2(dbToLaari(r.amount))}</td>
                <td className="px-2 py-2 text-right">{n2(dbToLaari(r.balance))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-right text-[12px] font-bold">Amount due MVR {n2(closing)}</p>
        <div className="mt-auto pt-8 text-[9.5px]">
          {company.bank_details && <><p className="font-semibold">Please pay to</p><p className="whitespace-pre-line">{company.bank_details}</p></>}
        </div>
      </LedgerSheet>
    </>
  );
}
