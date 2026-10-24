import type { UserRole } from "./types";
import { worksInTest, type Book } from "./books";

export interface NavItem {
  href: string;
  label: string;
  /** Roles allowed to see this item. Omitted = everyone signed in. */
  roles?: UserRole[];
  /**
   * The pages under this menu item, shown as tabs along the top of each of
   * them. The menu item opens the first tab the person can see, and is lit on
   * any of them.
   */
  tabs?: NavItem[];
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
 * Sidebar navigation: one item per area of work. An area's other pages are
 * tabs on its pages (see SectionTabs), so the menu stays short.
 */
export const NAV: NavGroup[] = [
  {
    group: "Work",
    defaultOpen: true,
    items: [
      { href: "/", label: "Dashboard", roles: ALL },
      { href: "/projects", label: "Projects", roles: ALL },
      { href: "/tasks", label: "Tasks & Calendar", roles: ALL },
      { href: "/messages", label: "Messages", roles: MONEY },
      {
        href: "/estimator", label: "Tools", roles: ALL, tabs: [
          { href: "/estimator", label: "Cabinet Estimator", roles: MONEY },
          { href: "/cut-planner", label: "Board cut planner", roles: ALL },
        ],
      },
    ],
  },
  {
    group: "Money",
    defaultOpen: true,
    items: [
      {
        href: "/sales", label: "Sales", roles: MONEY, tabs: [
          { href: "/sales", label: "Sales & invoices", roles: MONEY },
          { href: "/sales/customers", label: "Customers", roles: MONEY },
          { href: "/quotations", label: "Quotations", roles: MONEY },
        ],
      },
      {
        href: "/expenses", label: "Bills & expenses", roles: MONEY, tabs: [
          { href: "/expenses", label: "Bills & expenses", roles: MONEY },
          { href: "/expenses/vendors", label: "Vendors", roles: MONEY },
        ],
      },
      {
        href: "/payroll", label: "Payroll", roles: MONEY, tabs: [
          { href: "/payroll", label: "Pay runs", roles: MONEY },
          { href: "/payroll/employees", label: "Employees", roles: MONEY },
        ],
      },
      {
        href: "/partners", label: "Partners & financing", roles: MONEY, tabs: [
          { href: "/partners", label: "Partners & financing", roles: MONEY },
          { href: "/partners/lenders", label: "Lenders", roles: MONEY },
          { href: "/partners/distributions", label: "Distribution history", roles: MONEY },
        ],
      },
      { href: "/banking", label: "Banking", roles: MONEY },
      { href: "/taxes", label: "Taxes (GST)", roles: MONEY },
      {
        href: "/reports", label: "Reports", roles: MONEY, tabs: [
          { href: "/reports", label: "All reports", roles: MONEY },
          { href: "/reports/profit-loss", label: "Profit or loss", roles: MONEY },
          { href: "/reports/balance-sheet", label: "Balance sheet", roles: MONEY },
        ],
      },
      {
        href: "/accounting/chart", label: "Accounting", roles: MONEY, tabs: [
          { href: "/accounting/chart", label: "Chart of accounts", roles: MONEY },
          { href: "/accounting/journal", label: "Journal entries", roles: MONEY },
          { href: "/accounting/equipment", label: "Equipment register", roles: MONEY },
          { href: "/accounting/health", label: "Health check", roles: MONEY },
        ],
      },
    ],
  },
  {
    group: "Admin",
    defaultOpen: true,
    items: [
      {
        href: "/settings/company", label: "Settings", roles: MONEY, tabs: [
          { href: "/settings/company", label: "Company", roles: MONEY },
          { href: "/settings/accounting", label: "Accounting", roles: MONEY },
          { href: "/settings/taxes", label: "Taxes & rates", roles: MONEY },
          { href: "/settings/numbering", label: "Numbering", roles: MONEY },
          { href: "/settings/currencies", label: "Currencies", roles: MONEY },
          { href: "/settings/profit-share", label: "Profit-share schemes", roles: MONEY },
        ],
      },
    ],
  },
];

/** Every page the menu reaches, tabs included. */
export const navPages = (groups: NavGroup[] = NAV): NavItem[] =>
  groups.flatMap((g) => g.items.flatMap((i) => (i.tabs?.length ? i.tabs : [i])));

/** Shortcuts pinned above the navigation. Only routes present in NAV show. */
export const QUICK_ACTIONS: NavItem[] = [];

const navHrefs = new Set(navPages().map((i) => i.href));

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
  const shows = (i: NavItem) =>
    (!i.roles || i.roles.includes(r)) &&
    (opts.gstRegistered !== false || !GST_ONLY.has(i.href)) &&
    // in the Test book only the screens that keep the books apart are shown
    (opts.book !== "sandbox" || worksInTest(i.href));
  return NAV.map((g) => ({
    ...g,
    items: g.items.flatMap((i) => {
      if (!i.tabs) return shows(i) ? [i] : [];
      const tabs = i.tabs.filter(shows);
      // the item opens the first tab this person can see; with none, it goes
      return tabs.length ? [{ ...i, href: tabs[0].href, tabs }] : [];
    }),
  })).filter((g) => g.items.length > 0);
}

export function quickActionsFor(role: UserRole | undefined): NavItem[] {
  const r = role ?? "viewer";
  // a shortcut to a route that is not in the nav would be a dead end
  return QUICK_ACTIONS.filter(
    (a) => navHrefs.has(a.href) && (!a.roles || a.roles.includes(r)),
  );
}

const matches = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/**
 * The menu item a page belongs to, and which of its tabs: the closest match
 * wins, so /sales/customers is the Customers tab of Sales, not Sales & invoices.
 */
export function placeOf(groups: NavGroup[], pathname: string): { item: NavItem; tab: NavItem | null } | null {
  let best: { item: NavItem; tab: NavItem | null; len: number } | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    for (const page of item.tabs ?? [item]) {
      if (matches(pathname, page.href) && (!best || page.href.length > best.len)) {
        best = { item, tab: item.tabs ? page : null, len: page.href.length };
      }
    }
  }
  return best && { item: best.item, tab: best.tab };
}
