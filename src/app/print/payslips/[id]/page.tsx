import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { PrintToolbar } from "../../toolbar";
import { LedgerSheet, type Company } from "@/components/sales/ledger-sheet";
import { dbToLaari, laariToNumber } from "@/lib/money";

export const dynamic = "force-dynamic";
const n2 = (v: number | string | null | undefined) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(laariToNumber(dbToLaari(v)));
const month = (d: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
type Line = { amount: number; quantity: number | null; rate: number | null; pay_items: { name: string; kind: string; sort_order: number } };
type Slip = { id: string; gross: number; deductions: number; employer_contributions: number; net: number;
  employees: { name: string; job_title: string | null; bank_name: string | null; bank_account: string | null }; payslip_lines: Line[] };

/** Payslips for a run (or one, with ?slip=), one A4 page each. Payroll permission is enforced by the database. */
export default async function PrintPayslips({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ slip?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const [{ id }, { slip }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ data: run }, { data: company }] = await Promise.all([
    s.supabase.from("payroll_runs").select("period_month, pay_date").eq("id", id).maybeSingle(),
    s.supabase.from("company").select("legal_name, trade_name, tin, gst_registered, taxable_activity_no, address, phone, email, bank_details").eq("id", true).maybeSingle(),
  ]);
  if (!run || !company) notFound();
  let q = s.supabase.from("payslips").select("id, gross, deductions, employer_contributions, net, employees(name, job_title, bank_name, bank_account), payslip_lines(amount, quantity, rate, pay_items(name, kind, sort_order))").eq("run_id", id);
  if (slip) q = q.eq("id", slip);
  const { data } = await q;
  const slips = ((data ?? []) as unknown as Slip[]).sort((a, b) => a.employees.name.localeCompare(b.employees.name));
  return (
    <>
      <title>{`Payslips ${month(run.period_month)}`}</title>
      <PrintToolbar back={`/payroll/runs/${id}`} filename={`Payslips ${month(run.period_month)}`} />
      <div className="space-y-6 print:space-y-0">
        {slips.map((p) => {
          const lines = [...p.payslip_lines].sort((a, b) => a.pay_items.sort_order - b.pay_items.sort_order);
          const part = (k: string) => lines.filter((l) => l.pay_items.kind === k);
          return (
            <div key={p.id} className="break-after-page">
              <LedgerSheet company={company as Company} title="PAYSLIP">
                <div className="flex justify-between text-[10.5px]">
                  <div><p className="text-[12px] font-semibold">{p.employees.name}</p><p>{p.employees.job_title}</p></div>
                  <div className="text-right"><p>{month(run.period_month)}</p><p className="text-[#5b6675]">Paid {run.pay_date}</p></div>
                </div>
                {(["earning", "deduction", "employer_contribution"] as const).map((k) => part(k).length > 0 && (
                  <table key={k} className="mt-5 w-full text-[10px]">
                    <thead><tr className="border-b border-[#c9ced6] text-left text-[#5b6675]"><th className="py-1">{k === "earning" ? "Earnings" : k === "deduction" ? "Deductions" : "Paid by the company"}</th><th className="py-1 text-right">Amount</th></tr></thead>
                    <tbody>{part(k).map((l, i) => (
                      <tr key={i} className="border-b border-[#eef0f3]"><td className="py-1">{l.pay_items.name}{l.quantity != null ? ` (${Number(l.quantity)}${l.rate != null ? ` × ${n2(l.rate)}` : ""})` : ""}</td><td className="py-1 text-right">{n2(l.amount)}</td></tr>
                    ))}</tbody>
                  </table>
                ))}
                <table className="ml-auto mt-6 text-[11px]"><tbody>
                  <tr><td className="pr-8 text-right text-[#5b6675]">Gross pay</td><td className="text-right">{n2(p.gross)}</td></tr>
                  <tr><td className="pr-8 text-right text-[#5b6675]">Deductions</td><td className="text-right">{n2(p.deductions)}</td></tr>
                  <tr className="text-[13px] font-bold"><td className="pr-8 text-right">Net pay MVR</td><td className="text-right">{n2(p.net)}</td></tr>
                </tbody></table>
                {p.employees.bank_account && <p className="mt-6 text-[10px]">Paid to {p.employees.bank_name ?? "bank"} account {p.employees.bank_account}</p>}
              </LedgerSheet>
            </div>
          );
        })}
      </div>
    </>
  );
}
