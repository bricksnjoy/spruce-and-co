"use server";

import { revalidatePath } from "next/cache";
import { dbMessage, getSession } from "@/server/session";
import { laariToDb, moneyToDb, percentToDb, toLaari } from "@/lib/money";

export type Result = { error?: string; ok?: boolean; id?: string };

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const isDate = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** Payroll is for admin, finance, or someone given payroll permission (the database checks too). */
async function payroll() {
  const s = await getSession();
  if (!s) return { error: "Not signed in." } as const;
  if (!s.canPayroll) return { error: "You do not have payroll permission." } as const;
  return { s } as const;
}
const refresh = () => revalidatePath("/payroll", "layout");

export async function saveEmployee(_prev: unknown, fd: FormData): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  const id = text(fd, "id");
  const name = text(fd, "name");
  if (!name) return { error: "Enter the name." };
  const basic = moneyToDb(text(fd, "basic_salary") ?? "0");
  if (basic === null || basic.startsWith("-")) return { error: "Enter the basic salary as an amount." };
  const nat = text(fd, "nationality_type");
  if (nat !== "maldivian" && nat !== "expatriate") return { error: "Choose Maldivian or expatriate." };
  const dept = text(fd, "department");
  if (dept !== "site" && dept !== "admin") return { error: "Choose site or admin." };
  const dates = ["start_date", "end_date", "permit_expiry"].map((k) => text(fd, k));
  if (dates.some((d) => d !== null && !isDate(d))) return { error: "Enter dates as dates." };
  if (dates[0] && dates[1] && dates[1] < dates[0]) return { error: "The end date is before the start date." };
  const row = {
    name, nationality_type: nat, department: dept, basic_salary: basic, job_title: text(fd, "job_title"),
    pension_eligible: fd.get("pension_eligible") === "on", wht_applicable: fd.get("wht_applicable") === "on",
    bank_name: text(fd, "bank_name"), bank_account: text(fd, "bank_account"), start_date: dates[0], end_date: dates[1],
    permit_no: text(fd, "permit_no"), permit_expiry: dates[2], passport_no: text(fd, "passport_no"),
    phone: text(fd, "phone"), email: text(fd, "email"), active: fd.get("active") !== null ? fd.get("active") === "on" : true,
    needs_review: false, updated_at: new Date().toISOString(),
  };
  const { data, error } = id
    ? await p.s.supabase.from("employees").update(row).eq("id", id).select("id").single()
    : await p.s.supabase.from("employees").insert(row).select("id").single();
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true, id: data.id };
}

/** A standing allowance or deduction, copied into each new run. Blank removes it. */
export async function setStandingItem(employeeId: string, payItemId: string, amount: string): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  if (!isId(employeeId) || !isId(payItemId)) return { error: "Choose the item." };
  if (amount.trim() === "") {
    const { error } = await p.s.supabase.from("employee_pay_items").delete().eq("employee_id", employeeId).eq("pay_item_id", payItemId);
    if (error) return { error: dbMessage(error) };
  } else {
    const v = moneyToDb(amount);
    if (v === null || v.startsWith("-")) return { error: "Enter an amount of 0 or more." };
    const { error } = await p.s.supabase.from("employee_pay_items").upsert({ employee_id: employeeId, pay_item_id: payItemId, amount: v }, { onConflict: "employee_id,pay_item_id" });
    if (error) return { error: dbMessage(error) };
  }
  refresh();
  return { ok: true };
}

type AllocIn = { project_id: string | null; percent: string };

/** How an employee's cost is split across projects from a month on; must total 100%. */
export async function saveAllocations(employeeId: string, from: string, rows: AllocIn[]): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  if (!isId(employeeId) || !isDate(from)) return { error: "Choose the month it starts." };
  const clean = [];
  let total = 0n;
  for (const r of rows) {
    if (r.percent.trim() === "") continue;
    const pc = percentToDb(r.percent);
    if (pc === null || pc === "0") return { error: "Each share is a percentage above 0." };
    clean.push({ employee_id: employeeId, project_id: isId(r.project_id) ? r.project_id : null, percent: pc, effective_from: from });
    total += toLaari(pc) ?? 0n;
  }
  if (clean.length && total !== 10000n) return { error: `The shares must add up to 100% (they add up to ${laariToDb(total).replace(/\.00$/, "")}%).` };
  const keys = new Set(clean.map((c) => c.project_id ?? "overhead"));
  if (keys.size !== clean.length) return { error: "Each project appears once." };
  const del = await p.s.supabase.from("employee_allocations").delete().eq("employee_id", employeeId).eq("effective_from", from);
  if (del.error) return { error: dbMessage(del.error) };
  if (clean.length) {
    const { error } = await p.s.supabase.from("employee_allocations").insert(clean);
    if (error) return { error: dbMessage(error) };
  }
  refresh();
  return { ok: true };
}

export async function createRun(_prev: unknown, fd: FormData): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  const month = text(fd, "month");
  const pay = text(fd, "pay_date");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return { error: "Choose the month." };
  if (!isDate(pay)) return { error: "Enter the pay date." };
  const { data, error } = await p.s.supabase.rpc("rpc_create_payroll_run", { p_month: `${month}-01`, p_pay_date: pay });
  if (error) return { error: /duplicate key/.test(error.message) ? "There is already a run for that month." : dbMessage(error) };
  refresh();
  return { ok: true, id: data as string };
}

async function recalc(p: { s: NonNullable<Awaited<ReturnType<typeof getSession>>> }, slip: string): Promise<Result> {
  const { error } = await p.s.supabase.rpc("rpc_calc_payslip", { p_payslip: slip });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

/** Add a line to a payslip: overtime hours, no-pay days, a bonus, an allowance or a deduction. */
export async function addPayslipLine(slip: string, payItemId: string, qty: string, rate: string, amount: string): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  if (!isId(slip) || !isId(payItemId)) return { error: "Choose the item." };
  const { data: item } = await p.s.supabase.from("pay_items").select("calc, code, name").eq("id", payItemId).maybeSingle();
  if (!item) return { error: "No such item." };
  let row: { payslip_id: string; pay_item_id: string; quantity?: string; rate?: string | null; amount?: string };
  if (item.calc === "hours" || item.calc === "days") {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(qty)) return { error: `Enter the ${item.calc === "hours" ? "hours" : "days"}.` };
    const r = rate.trim() === "" ? null : moneyToDb(rate);
    if (item.code !== "NOPAY" && (r === null || r.startsWith("-"))) return { error: "Enter the rate per hour." };
    row = { payslip_id: slip, pay_item_id: payItemId, quantity: qty, rate: r };
  } else if (item.calc === "fixed") {
    const a = moneyToDb(amount);
    if (a === null || a.startsWith("-")) return { error: "Enter the amount." };
    row = { payslip_id: slip, pay_item_id: payItemId, amount: a };
  } else return { error: `${item.name} is worked out by the system.` };
  const { error } = await p.s.supabase.from("payslip_lines").insert(row);
  if (error) return { error: dbMessage(error) };
  return recalc(p, slip);
}

export async function removePayslipLine(slip: string, lineId: string): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  const { error } = await p.s.supabase.from("payslip_lines").delete().eq("id", lineId).eq("payslip_id", slip).eq("computed", false);
  if (error) return { error: dbMessage(error) };
  return recalc(p, slip);
}

/** This month's split of one payslip's cost across projects. */
export async function setPayslipAllocations(slip: string, rows: AllocIn[]): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  let total = 0n;
  const clean = [];
  for (const r of rows) {
    if (r.percent.trim() === "") continue;
    const pc = percentToDb(r.percent);
    if (pc === null || pc === "0") return { error: "Each share is a percentage above 0." };
    clean.push({ payslip_id: slip, project_id: isId(r.project_id) ? r.project_id : null, quantity: pc });
    total += toLaari(pc) ?? 0n;
  }
  if (total !== 10000n) return { error: "The shares must add up to 100%." };
  const del = await p.s.supabase.from("labour_allocations").delete().eq("payslip_id", slip);
  if (del.error) return { error: dbMessage(del.error) };
  const { error } = await p.s.supabase.from("labour_allocations").insert(clean);
  if (error) return { error: dbMessage(error) };
  return recalc(p, slip);
}

export async function addToRun(run: string, employee: string): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  const { error } = await p.s.supabase.rpc("rpc_add_payslip", { p_run: run, p_employee: employee });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

export async function removeFromRun(slip: string): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  const { error } = await p.s.supabase.rpc("rpc_remove_payslip", { p_payslip: slip });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

export async function setRunStatus(run: string, status: "draft" | "review"): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  const { error } = await p.s.supabase.rpc("rpc_set_payroll_status", { p_run: run, p_status: status });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

/** Approving posts the run to the ledger. An admin with payroll permission does it (the MD's approval). */
export async function approveRun(run: string): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  if (p.s.role !== "admin") return { error: "Only an admin approves a payroll run." };
  const { error } = await p.s.supabase.rpc("rpc_approve_payroll_run", { p_run: run });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

export async function paySalaries(run: string, bank: string, date: string): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  if (!isId(bank)) return { error: "Choose the account to pay from." };
  if (!isDate(date)) return { error: "Enter the date paid." };
  const { error } = await p.s.supabase.rpc("rpc_pay_salaries", { p_run: run, p_bank: bank, p_date: date });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true };
}

/** A salary advance, and how much is taken back from each month's pay. */
export async function giveAdvance(_prev: unknown, fd: FormData): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  const employee = text(fd, "employee_id");
  const date = text(fd, "date");
  const bank = text(fd, "bank_account_id");
  const amount = toLaari(text(fd, "amount"));
  const instalment = toLaari(text(fd, "instalment"));
  const start = text(fd, "start_month");
  if (!isId(employee)) return { error: "No employee." };
  if (!isDate(date)) return { error: "Enter the date." };
  if (!isId(bank)) return { error: "Choose the account it was paid from." };
  if (amount === null || amount <= 0n) return { error: "Enter the amount advanced." };
  if (instalment === null || instalment <= 0n || instalment > amount) return { error: "Enter the monthly recovery (no more than the advance)." };
  if (!start || !/^\d{4}-\d{2}$/.test(start)) return { error: "Choose the month recovery starts." };
  const { data, error } = await p.s.supabase.rpc("rpc_save_transaction", { p: {
    type: "staff_advance", date, employee_id: employee, bank_account_id: bank, total_amount: laariToDb(amount), memo: text(fd, "memo") ?? "Salary advance",
  } });
  if (error) return { error: dbMessage(error) };
  const rec = await p.s.supabase.from("advance_recoveries").insert({ employee_id: employee, advance_transaction_id: data, instalment: laariToDb(instalment), start_month: `${start}-01` });
  if (rec.error) return { error: `The advance is recorded, but its recovery was not: ${dbMessage(rec.error)}` };
  refresh();
  return { ok: true, id: data as string };
}

/** Pay pension or withholding tax over to the authority. */
export async function remit(_prev: unknown, fd: FormData): Promise<Result> {
  const p = await payroll();
  if ("error" in p) return { error: p.error };
  const date = text(fd, "date");
  const bank = text(fd, "bank_account_id");
  const account = text(fd, "account_id");
  const amount = toLaari(text(fd, "amount"));
  if (!isDate(date)) return { error: "Enter the date paid." };
  if (!isId(bank)) return { error: "Choose the account it was paid from." };
  if (!isId(account)) return { error: "Choose what is being paid over." };
  if (amount === null || amount <= 0n) return { error: "Enter the amount." };
  const { data, error } = await p.s.supabase.rpc("rpc_save_transaction", { p: {
    type: "payroll_remittance", date, bank_account_id: bank, reference: text(fd, "reference"),
    lines: [{ account_id: account, amount: laariToDb(amount), description: text(fd, "memo") }],
  } });
  if (error) return { error: dbMessage(error) };
  refresh();
  return { ok: true, id: data as string };
}
