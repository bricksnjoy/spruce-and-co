import type { UserRole } from "./types";
import { worksInTest, type Book } from "./books";

export interface NavItem {
  href: string;
  label: string;
  /** Roles allowed to see this item. Omitted = everyone signed in. */
  roles?: UserRole[];
}

export interface NavGroup {
  group: string;
  /** Collapsed by default unless the current route is inside it. */
  defaultOpen?: boolean;
  items: NavItem[];
}

const ALL: UserRole[] = ["admin", "manager", "finance", "viewer"];
const MONEY: UserRole[] = ["admin", "manager", "finance"];

/**
 * Sidebar navigation. Modules are added back here one at a time as they are
 * built; the earlier full set lives in the git history.
 */
export const NAV: NavGroup[] = [
  {
    group: "Core",
    defaultOpen: true,
    items: [
      { href: "/", label: "Dashboard", roles: ALL },
      { href: "/projects", label: "Projects", roles: ALL },
      { href: "/tasks", label: "Tasks & Calendar", roles: ALL },
      { href: "/messages", label: "Message Center", roles: MONEY },
      { href: "/pnl", label: "Project P&L", roles: MONEY },
    ],
  },
  {
    group: "Sales",
    defaultOpen: true,
    items: [
      { href: "/sales", label: "Sales & invoices", roles: MONEY },
      { href: "/sales/customers", label: "Customers", roles: MONEY },
      { href: "/quotations", label: "Quotations", roles: MONEY },
      { href: "/invoices", label: "Invoices (old)", roles: MONEY },
      { href: "/estimator", label: "Cabinet Estimator", roles: MONEY },
    ],
  },
  {
    group: "Expenses",
    defaultOpen: true,
    items: [
      { href: "/expenses", label: "Bills & expenses", roles: MONEY },
      { href: "/expenses/vendors", label: "Vendors", roles: MONEY },
    ],
  },
  {
    group: "People",
    defaultOpen: true,
    items: [
      { href: "/payroll", label: "Payroll", roles: MONEY },
      { href: "/payroll/employees", label: "Employees", roles: MONEY },
    ],
  },
  {
    group: "Finance",
    defaultOpen: true,
    items: [
      { href: "/capital-pool", label: "Capital Pool", roles: MONEY },
      { href: "/investors", label: "Investors", roles: MONEY },
      { href: "/financing", label: "Project Financing", roles: MONEY },
      { href: "/internal", label: "Internal Account", roles: MONEY },
    ],
  },
  {
    group: "Accounting",
    defaultOpen: true,
    items: [
      { href: "/accounting", label: "Overview", roles: MONEY },
      { href: "/accounting/ledger", label: "Ledger", roles: MONEY },
      { href: "/accounting/audit", label: "Self-audit", roles: MONEY },
      { href: "/accounting/statements", label: "Financial statements", roles: MONEY },
      { href: "/banking", label: "Banking", roles: MONEY },
      { href: "/accounting/bank", label: "Bank reconciliation (old)", roles: MONEY },
      { href: "/taxes", label: "Taxes (GST)", roles: MONEY },
      { href: "/accounting/tax", label: "Tax (old)", roles: MONEY },
      { href: "/accounting/equipment", label: "Equipment register", roles: MONEY },
      { href: "/accounting/year-end", label: "Year end", roles: MONEY },
      { href: "/gst", label: "GST Input Schedule (old)", roles: MONEY },
      { href: "/accounting/chart", label: "Chart of accounts", roles: MONEY },
      { href: "/accounting/health", label: "Health check", roles: MONEY },
    ],
  },
  {
    group: "Admin",
    defaultOpen: true,
    items: [
      { href: "/settings/company", label: "Company", roles: MONEY },
      { href: "/settings/accounting", label: "Accounting settings", roles: MONEY },
      { href: "/settings/taxes", label: "Taxes & rates", roles: MONEY },
      { href: "/settings/numbering", label: "Numbering", roles: MONEY },
      { href: "/settings/currencies", label: "Currencies", roles: MONEY },
      { href: "/profit-share", label: "Profit Share", roles: MONEY },
    ],
  },
];

/** Shortcuts pinned above the navigation. Only routes present in NAV show. */
export const QUICK_ACTIONS: NavItem[] = [];

const navHrefs = new Set(NAV.flatMap((g) => g.items.map((i) => i.href)));

/**
 * Routes that only make sense once the company is registered for GST. Input
 * tax cannot be claimed before then, so a filing screen would be inviting a
 * claim that does not exist.
 */
const GST_ONLY = new Set(["/gst"]);

export function visibleFor(
  role: UserRole | undefined,
  opts: { gstRegistered?: boolean; book?: Book } = {},
): NavGroup[] {
  const r = role ?? "viewer";
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        (!i.roles || i.roles.includes(r)) &&
        (opts.gstRegistered !== false || !GST_ONLY.has(i.href)) &&
        // in the Test book only the screens that keep the books apart are shown
        (opts.book !== "sandbox" || worksInTest(i.href)),
    ),
  })).filter((g) => g.items.length > 0);
}

export function quickActionsFor(role: UserRole | undefined): NavItem[] {
  const r = role ?? "viewer";
  // a shortcut to a route that is not in the nav would be a dead end
  return QUICK_ACTIONS.filter(
    (a) => navHrefs.has(a.href) && (!a.roles || a.roles.includes(r)),
  );
}
