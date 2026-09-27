import { today as todayMv } from "@/lib/format";
import type { Records } from "@/lib/accounting";

/**
 * The checks an auditor would run over the books, each finding the records
 * that need a second look and saying why it matters. Items marked "looks
 * fine" in audit_marks drop out; queried ones stay flagged.
 */

export type Severity = "high" | "medium" | "low";

export interface CheckItem {
  id: string;
  label: string;
  detail?: string;
  amount?: number;
  href: string;
}

export interface Check {
  key: string;
  title: string;
  why: string;
  severity: Severity;
  items: CheckItem[];
  /** a one-click correction the page can offer */
  fix?: { action: "bills-paid-in-full"; label: string };
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/private limited|pvt\.? ?ltd\.?|[^a-z0-9]/g, "");

export function runChecks(r: Records, vendors: { id: string; name: string }[]): Check[] {
  const today = todayMv();
  const live = r.bills.filter((b) => b.status !== "void" && b.status !== "draft");
  const vendorOf = (b: (typeof r.bills)[number]) => (b.vendors as unknown as { name: string; tin: string | null } | null) ?? null;
  const proj = new Map(r.projects.map((p) => [p.id, p]));
  const billItem = (b: (typeof r.bills)[number], detail?: string): CheckItem => ({
    id: b.id,
    label: `${vendorOf(b)?.name ?? "Unknown supplier"} · ${b.bill_no ? `bill ${b.bill_no}` : "no bill number"} · ${day(b.issue_date) ?? "no date"}`,
    detail: detail ?? (b.description || undefined),
    amount: n(b.total),
    href: b.project_id ? `/projects/${b.project_id}` : "/projects",
  });
  const checks: Check[] = [];

  // ── bills ──
  checks.push({
    key: "bill-future",
    title: "Bills dated in the future",
    why: "A date that has not come yet is usually a typing mistake, and it puts the cost in the wrong period.",
    severity: "high",
    items: live.filter((b) => day(b.issue_date) && day(b.issue_date)! > today).map((b) => billItem(b)),
  });
  checks.push({
    key: "bill-total",
    title: "Bill totals that do not add up",
    why: "Subtotal plus GST should equal the total. A difference means a figure was read or typed wrong.",
    severity: "high",
    items: live
      .filter((b) => n(b.subtotal) > 0 && Math.abs(n(b.subtotal) + n(b.tax_amount) - n(b.total)) > 0.05)
      .map((b) => billItem(b, `${n(b.subtotal).toFixed(2)} + ${n(b.tax_amount).toFixed(2)} GST ≠ ${n(b.total).toFixed(2)}`)),
  });
  // the same supplier, amount and (nearly) date, or the same bill number twice
  const dupes: CheckItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (!a.vendor_id || a.vendor_id !== b.vendor_id) continue;
      const sameNo = a.bill_no && b.bill_no && norm(a.bill_no) === norm(b.bill_no);
      const sameAmt = Math.abs(n(a.total) - n(b.total)) < 0.01 && a.issue_date && b.issue_date && Math.abs(days(day(a.issue_date)!, day(b.issue_date)!)) <= 3;
      if (!sameNo && !sameAmt) continue;
      for (const x of [a, b]) {
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        dupes.push(billItem(x, sameNo ? `same bill number as another from this supplier` : `same supplier and amount within 3 days of another`));
      }
    }
  }
  checks.push({
    key: "bill-duplicate",
    title: "Possible duplicate bills",
    why: "The same bill entered twice counts the cost twice — it lowers the profit and the partners' shares.",
    severity: "high",
    items: dupes,
  });
  checks.push({
    key: "bill-receipt",
    title: "Bills without a photo of the receipt",
    why: "Without the original there is nothing to show MIRA or an auditor that the cost is real.",
    severity: "medium",
    items: live.filter((b) => !b.attachment_path).map((b) => billItem(b)),
  });
  checks.push({
    key: "bill-category",
    title: "Bills without a cost category",
    why: "Uncategorised costs cannot be compared with the budget or broken down in the profit and loss.",
    severity: "medium",
    items: live.filter((b) => !b.category_id).map((b) => billItem(b)),
  });
  checks.push({
    key: "bill-project-dates",
    title: "Bills far outside their project's dates",
    why: "A bill dated months before the project started, or on a cancelled job, may belong to another project.",
    severity: "medium",
    items: live
      .filter((b) => {
        const p = b.project_id ? proj.get(b.project_id) : null;
        if (!p) return false;
        if (p.status === "cancelled" || p.status === "lead") return true;
        const d = day(b.issue_date);
        return Boolean(d && p.start_date && days(d, p.start_date) > 60);
      })
      .map((b) => {
        const p = proj.get(b.project_id!)!;
        return billItem(b, p.status === "cancelled" || p.status === "lead" ? `project ${p.code} is ${p.status}` : `project ${p.code} started ${p.start_date}`);
      }),
  });
  checks.push({
    key: "bill-gst-tin",
    title: "GST charged by a supplier with no TIN recorded",
    why: r.gstRegistered
      ? "Input GST can only be claimed on a tax invoice showing the supplier's TIN."
      : "Once the company registers for GST, input tax can only be claimed on invoices showing the supplier's TIN.",
    severity: r.gstRegistered ? "medium" : "low",
    items: live.filter((b) => n(b.tax_amount) > 0 && !vendorOf(b)?.tin).map((b) => billItem(b, `${n(b.tax_amount).toFixed(2)} GST`)),
  });
  const paidShort = live.filter((b) => b.status === "paid" && n(b.amount_paid) < n(b.total) - 0.005);
  checks.push({
    key: "bill-paid-amount",
    title: "Bills marked paid with no payment amount",
    why: "The status says paid, but the amount paid is not recorded, so what is still owed to suppliers cannot be worked out.",
    severity: "low",
    items: paidShort.map((b) => billItem(b, `paid ${n(b.amount_paid).toFixed(2)} of ${n(b.total).toFixed(2)}`)),
    fix: paidShort.length ? { action: "bills-paid-in-full", label: `Record all ${paidShort.length} as paid in full` } : undefined,
  });

  // ── clients and projects ──
  const variation = (id: string) => r.variations.filter((v) => v.project_id === id && v.status === "approved").reduce((s, v) => s + n(v.cost_impact), 0);
  const cost = (id: string) => live.filter((b) => b.project_id === id).reduce((s, b) => s + n(b.total), 0);
  checks.push({
    key: "project-unpaid",
    title: "Finished projects the client has not paid for",
    why: "Money earned but not collected. The longer it waits, the harder it is to collect.",
    severity: "high",
    items: r.projects
      .filter((p) => p.status === "completed" && !p.payment_received_at && !r.invoices.some((i) => i.project_id === p.id && i.status === "paid"))
      .map((p) => ({ id: p.id, label: `${p.code} ${p.name}`, detail: p.completed_at ? `completed ${day(p.completed_at)}` : "completed", amount: n(p.contract_value) + variation(p.id), href: `/projects/${p.id}` })),
  });
  checks.push({
    key: "project-payment-diff",
    title: "Client payments that differ from the contract",
    why: "What the client paid should match the contract plus approved variations (and GST, where charged). A gap is either a discount to record or money still owed.",
    severity: "medium",
    items: r.projects
      .filter((p) => p.payment_received_at && n(p.payment_received_amount) > 0)
      .map((p) => {
        const due = n(p.contract_value) + variation(p.id);
        const gst = n(p.gst_amount);
        const paid = n(p.payment_received_amount);
        const off = Math.min(Math.abs(paid - due), gst ? Math.abs(paid - due - gst) : Infinity);
        return { p, due, gst, paid, off };
      })
      .filter((x) => x.off > Math.max(1, x.due * 0.01))
      .map(({ p, due, gst, paid }) => ({
        id: p.id,
        label: `${p.code} ${p.name}`,
        detail: `paid ${paid.toFixed(2)} against ${due.toFixed(2)}${gst ? ` (+${gst.toFixed(2)} GST)` : ""}`,
        amount: paid - due,
        href: `/projects/${p.id}`,
      })),
  });
  checks.push({
    key: "project-loss",
    title: "Projects costing more than they earn",
    why: "Costs above the contract value mean a loss — or bills put against the wrong project.",
    severity: "medium",
    items: r.projects
      .filter((p) => p.status !== "cancelled" && n(p.contract_value) > 0 && cost(p.id) > n(p.contract_value) + variation(p.id))
      .map((p) => ({ id: p.id, label: `${p.code} ${p.name}`, detail: `costs ${cost(p.id).toFixed(2)} against ${(n(p.contract_value) + variation(p.id)).toFixed(2)}`, amount: n(p.contract_value) + variation(p.id) - cost(p.id), href: `/projects/${p.id}` })),
  });
  checks.push({
    key: "project-no-costs",
    title: "Active or finished projects with no bills",
    why: "Every job has costs. None recorded means bills are missing, or were put on another project.",
    severity: "low",
    items: r.projects
      .filter((p) => (p.status === "in_progress" || p.status === "completed") && !live.some((b) => b.project_id === p.id))
      .map((p) => ({ id: p.id, label: `${p.code} ${p.name}`, detail: p.status.replace("_", " "), href: `/projects/${p.id}` })),
  });
  checks.push({
    key: "invoice-overdue",
    title: "Invoices past their due date",
    why: "Sent but not paid in time — chase the client.",
    severity: "medium",
    items: r.invoices
      .filter((i) => i.status === "sent" && i.due_date && day(i.due_date)! < today)
      .map((i) => ({ id: i.id, label: `Invoice ${i.number} · ${i.to_name ?? ""}`, detail: `due ${day(i.due_date)}, ${days(day(i.due_date)!, today)} days ago`, amount: n(r.invoiceTotals.find((t) => t.invoice_id === i.id)?.total), href: `/invoices/${i.id}` })),
  });
  const seqs = r.invoices.map((i) => n(i.seq)).filter((s) => s > 0).sort((a, b) => a - b);
  const gaps: CheckItem[] = [];
  for (let k = 1; k < seqs.length; k++) {
    for (let s = seqs[k - 1] + 1; s < seqs[k]; s++) gaps.push({ id: `gap-${s}`, label: `Invoice number ${s} is missing`, detail: "numbers should run without gaps", href: "/invoices" });
  }
  checks.push({
    key: "invoice-gap",
    title: "Gaps in invoice numbers",
    why: "Tax invoices must be numbered in an unbroken sequence; a gap looks like a deleted invoice.",
    severity: "medium",
    items: gaps,
  });
  checks.push({
    key: "quote-not-invoiced",
    title: "Won quotations with no invoice",
    why: "Work was won but nothing has been billed for it yet.",
    severity: "low",
    items: r.quotations
      .filter((q) => q.status === "won" && !r.invoices.some((i) => i.project_id && i.project_id === q.project_id))
      .filter((q) => !(q.project_id && proj.get(q.project_id)?.payment_received_at))
      .map((q) => ({ id: q.id, label: `Quotation ${q.number}`, detail: q.project_id ? proj.get(q.project_id)?.code : undefined, href: `/quotations/${q.id}` })),
  });

  // ── partners, investors, salaries ──
  const balance = new Map<string, number>();
  for (const e of r.pool) balance.set(e.member_id, (balance.get(e.member_id) ?? 0) + n(e.amount));
  checks.push({
    key: "pool-negative",
    title: "Capital pool members with a negative balance",
    why: "A member has taken out more than they put in or earned — that is a loan to them, and should be agreed.",
    severity: "high",
    items: r.members
      .filter((m) => (balance.get(m.id) ?? 0) < -0.005)
      .map((m) => ({ id: m.id, label: m.name, amount: balance.get(m.id), href: "/capital-pool" })),
  });
  const owed = new Map<string, { name: string; project: string | null; amount: number }>();
  for (const e of r.internal) {
    const k = `${e.project_id}|${e.share_name}`;
    const o = owed.get(k) ?? { name: e.share_name, project: e.project_id, amount: 0 };
    o.amount += n(e.amount);
    owed.set(k, o);
  }
  checks.push({
    key: "share-unsettled",
    title: "Profit shares still owed after the client paid",
    why: "When a client pays, each partner's and investor's share should be paid out or kept as capital. These are still sitting as owed.",
    severity: "medium",
    items: [...owed.entries()]
      .filter(([, o]) => Math.abs(o.amount) > 0.5 && o.project && proj.get(o.project)?.payment_received_at)
      .map(([k, o]) => ({ id: k, label: `${o.name} · ${proj.get(o.project!)?.code ?? ""}`, amount: o.amount, href: "/internal" })),
  });
  checks.push({
    key: "salary-slip",
    title: "Salaries paid without a slip",
    why: "A signed slip or transfer receipt is the proof the salary was paid.",
    severity: "low",
    items: r.salaries
      .filter((s) => !s.slip_path)
      .map((s) => ({ id: s.id, label: `${(s.people as unknown as { name: string } | null)?.name ?? "Someone"} · ${String(s.month).slice(0, 7)}`, amount: n(s.amount), href: "/salaries" })),
  });

  // ── suppliers ──
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const v of vendors) {
    const k = norm(v.name);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  checks.push({
    key: "vendor-duplicate",
    title: "Suppliers entered more than once",
    why: "The same shop under two names splits its bills, so totals per supplier and GST checks come out wrong.",
    severity: "low",
    items: [...groups.values()].filter((g) => g.length > 1).flat().map((v) => ({ id: v.id, label: v.name, href: `/shops/${v.id}` })),
  });

  return checks;
}

export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
