/**
 * How to use each page. One entry per screen; the box at the top of the page,
 * the Help page and docs/USER_GUIDE.md are all made from this list.
 * `path` is the address with [brackets] where an id goes.
 */
export type Help = { path: string; area: string; title: string; purpose: string; steps: string[]; tips?: string[] };

export const HELP: Help[] = [
  // ── Everyday ──
  {
    path: "/", area: "Everyday", title: "Dashboard",
    purpose: "Where the business stands today: cash, who owes what, profit, GST, payroll, payouts, projects and a 12-week cash forecast.",
    steps: [
      "Read the four tiles at the top: cash and bank, what customers owe, what you owe vendors (each with the overdue part), and profit this month with the year to date.",
      "Check the cash forecast: the line is the cash expected at the end of each of the next 12 weeks. Hover a point to see money in and out that week; \"Week by week\" opens the full table.",
      "Cash by account shows each bank and cash balance; an amber \"reconcile\" means that account has not been reconciled to the end of last month.",
      "The small cards show this quarter's GST and its due date, the next payroll, payouts ready or blocked, and how many accounts need reconciling. Each has a link to its screen.",
      "Active projects lists the biggest jobs with contract value, billed and forecast profit. Click one to open it.",
    ],
    tips: ["Everything here comes from the ledger of the book you are in (Live or Test — the switch at the top of every page)."],
  },
  {
    path: "/search", area: "Everyday", title: "Search",
    purpose: "Find any document, customer, vendor, project, employee or account.",
    steps: [
      "Type in the search box at the top of any page and press Enter: part of a document number (INV/26/004), a name, or an exact amount (12500).",
      "Results come grouped: documents, contacts, projects, employees, accounts. Click one to open it.",
    ],
    tips: ["An amount matches a document's total exactly, so type it without commas or with them — both work."],
  },
  {
    path: "/help", area: "Everyday", title: "Help",
    purpose: "This guide: how to use every page, in one place.",
    steps: ["Pick a page from the list, or open any page and use its \"How to use this page\" box at the top."],
  },

  // ── Projects ──
  {
    path: "/projects", area: "Projects", title: "Projects",
    purpose: "Every project with its value, billing, cost, forecast profit and stage (active → completed → settled → closed).",
    steps: [
      "Use \"New project\" (or + New → Project) to add one.",
      "Read across a row: revised contract value, % billed, collected, cost to date, forecast profit and margin, and what the client still owes.",
      "Click a project to open it. Use \"Archived\" to see projects taken out of the working list.",
    ],
  },
  {
    path: "/projects/new", area: "Projects", title: "New project",
    purpose: "Set up a project so invoices, bills, payroll and financing can be charged to it.",
    steps: [
      "Enter the project name; the code is suggested (SC-001, SC-002 …) and can be changed.",
      "Choose the customer (or add one from the form), the start date and the contract value.",
      "Choose how revenue is recognised: as billed, by percentage of completion, or the company default.",
      "Press \"Create project\". Budget, variations and billing stages are added on the project's own page.",
    ],
    tips: ["The profit-share scheme the project uses is the one in force on its start date."],
  },
  {
    path: "/projects/[id]", area: "Projects", title: "Project page",
    purpose: "One project from start to payout, in tabs.",
    steps: [
      "Overview: contract value, billed, collected, cost to date, forecast profit, % complete and over/under-billing.",
      "Value & budget: set budget lines by category; see budget against actual and committed (open purchase orders). Amber/red warnings mean a category is past 80% or 100%.",
      "Bills: every bill on the project. \"New bill\" opens the bill form in a pop-up. To add many: \"Download template\", fill one row per bill line (rows with the same vendor and supplier invoice no. make one bill), \"Upload filled sheet\", check the rows (problems show in red), then \"Save\". \"Download bills (Excel)\" gives the bills already added in the same layout — add rows and upload it again; bills already saved are recognised and skipped.",
      "Variations: raise a variation; only approved ones change the contract value.",
      "Billing plan: stages of the contract; turn a stage into an invoice when it is due.",
      "Financing: record money received for the project — a Capital Pool member's contribution or an external lender's loan — and see each source's share of the financing.",
      "Profit split: before completion, a preview of who gets what on the profit to date. Tick the box and \"Complete and post split\" to complete the project.",
      "Payouts: whether payouts are released (the client must owe nothing) and what each person is owed.",
      "Transactions: every document posted to the project.",
    ],
    tips: [
      "Buttons at the top: New invoice, New bill (opens the Bills tab with the form), Edit, Archive. \"Old view\" shows the project as the old screens saw it (Live only).",
      "Anything posted to a completed project later (a cost, a bad debt) adjusts the split with its own entry and flags the project for review.",
    ],
  },
  {
    path: "/projects/[id]/edit", area: "Projects", title: "Edit project",
    purpose: "Change a project's name, customer, dates, value or recognition method.",
    steps: ["Change the fields and press \"Save changes\"."],
  },
  {
    path: "/pnl", area: "Projects", title: "Project P&L (older screen)",
    purpose: "The project profit table from the old screens, kept for reference.",
    steps: ["Read value, variation, GST, expenses and profit per project as the old records have them."],
    tips: ["For figures from the new books use the project's Overview tab or Reports → Profit or loss by project."],
  },

  // ── Sales ──
  {
    path: "/sales", area: "Sales", title: "Sales & invoices",
    purpose: "Every invoice, credit note, sales receipt, payment and deposit, with what is still owed.",
    steps: [
      "Use the tabs: All, Invoices, Unpaid, Overdue, Deposits.",
      "The status shows draft, sent, part paid, paid, overdue or void.",
      "Click a document to open it. New documents come from + New (Invoice, Receive payment, Sales receipt, Credit note, Bank deposit).",
    ],
  },
  {
    path: "/sales/new", area: "Sales", title: "New invoice / credit note / sales receipt",
    purpose: "Bill a customer (invoice), reduce what they owe (credit note), or record a sale paid on the spot (sales receipt).",
    steps: [
      "Choose the customer; the due date follows their payment terms. Choose the project if the work is for one.",
      "For a sales receipt, choose the account the money went into (or leave it in Undeposited Funds to bank later).",
      "Add lines: description, quantity and rate (or just an amount), GST code and income account. The total with GST shows as you type.",
      "Press \"Save invoice\" (or credit note / receipt). It is posted to the books at once.",
    ],
    tips: ["Save as draft if it is not final; a draft posts nothing.", "Foreign currency: choose USD and enter the MVR rate."],
  },
  {
    path: "/sales/[id]", area: "Sales", title: "Sales document",
    purpose: "One invoice, credit note, receipt or payment: its lines, GST, payments applied and what is still owed.",
    steps: [
      "Print / PDF opens the tax invoice to print or save.",
      "Mark sent records that it went to the customer.",
      "Receive payment opens a payment for this customer.",
      "Edit changes it (the new figures replace the old; the change is kept in the audit log). Void keeps it on record but reverses it.",
    ],
    tips: ["A document with payments applied cannot be voided until the payments are removed or voided."],
  },
  {
    path: "/sales/[id]/edit", area: "Sales", title: "Edit sales document",
    purpose: "Correct an invoice, credit note or receipt.",
    steps: ["Change what is wrong and press \"Save changes\"; the posting is redone."],
    tips: ["A document dated in a filed GST quarter or before the closing date cannot change silently: the GST difference goes into the next open return."],
  },
  {
    path: "/sales/payments/new", area: "Sales", title: "Receive payment",
    purpose: "Record money from a customer and apply it to their invoices.",
    steps: [
      "Choose the customer; their open invoices appear.",
      "Enter the date, the amount received and the account it went into.",
      "Type how much goes to each invoice (\"Apply to …\"). Anything left over is held as the customer's credit.",
      "Press \"Save payment\".",
    ],
  },
  {
    path: "/sales/deposits/new", area: "Sales", title: "Bank deposit",
    purpose: "Move receipts from Undeposited Funds into the bank, the way the bank statement shows them.",
    steps: ["Choose the bank account and date, tick the receipts in the deposit, and press \"Save deposit\"."],
  },
  {
    path: "/sales/advances", area: "Sales", title: "Client advances",
    purpose: "Money received before invoicing, held as Customer Advances until applied to invoices.",
    steps: ["Record an advance: customer, date, amount and account, then \"Save advance\".", "When invoices are raised, use the Apply form on this page: choose the customer, type how much of the advance goes to each invoice, and press \"Apply advance\"."],
  },
  {
    path: "/sales/customers", area: "Sales", title: "Customers",
    purpose: "Every customer with what they owe and what is overdue.",
    steps: [
      "\"New customer\" adds one: name, TIN, GST registration, payment terms, currency.",
      "Tabs: Active, Needs review (copied from the old lists — confirm each is real), Archived.",
      "Click a customer to open them.",
    ],
  },
  {
    path: "/sales/customers/[id]", area: "Sales", title: "Customer",
    purpose: "One customer: their details, documents, projects and statement.",
    steps: [
      "Tabs: Transactions, Projects, Statement (choose From/To, then Print / PDF), Details (edit).",
      "Buttons: New invoice, Receive payment. Archive takes them out of the lists without deleting anything.",
    ],
  },

  // ── Expenses ──
  {
    path: "/expenses", area: "Expenses", title: "Bills & expenses",
    purpose: "Every bill, expense, vendor credit, purchase order and bill payment.",
    steps: ["Use the tabs: All, Bills, Expenses, Unpaid, Overdue.", "Click one to open it. New ones come from + New (Bill, Pay bills, Expense, Vendor credit, Purchase order)."],
  },
  {
    path: "/expenses/new", area: "Expenses", title: "New bill / expense / vendor credit / purchase order",
    purpose: "Record what you owe a vendor (bill), something already paid (expense), a vendor's credit, or an order not yet billed.",
    steps: [
      "Optional: upload a photo of the bill and press \"Read the photo\" to fill in the vendor, TIN, invoice number and lines.",
      "Choose the vendor and the project (or overhead). For an expense, choose the account it was paid from.",
      "Enter the supplier's TIN, tax invoice number and date — needed to claim the GST.",
      "Add lines: account, description, amount before GST, the supplier's GST figure, and the project. Untick \"claimable\" when the GST cannot be claimed (it then becomes cost).",
      "Press \"Save bill\" (or expense …).",
    ],
    tips: ["Bills above the approval limit (Settings → Accounting) wait for an admin's approval before they post."],
  },
  {
    path: "/expenses/[id]", area: "Expenses", title: "Bill or expense",
    purpose: "One document: lines, GST, payments and what is still owed.",
    steps: [
      "Pay opens Pay bills for it. Approve and post appears for an admin when a bill is waiting for approval.",
      "A vendor credit shows \"Apply\" against the vendor's open bills. A purchase order has \"Turn into a bill\" and Close/Reopen.",
      "Edit changes it; Void reverses it (the reason is kept).",
    ],
  },
  {
    path: "/expenses/[id]/edit", area: "Expenses", title: "Edit bill or expense",
    purpose: "Correct a bill, expense, credit or order.",
    steps: ["Change what is wrong and press \"Save changes\"."],
  },
  {
    path: "/expenses/pay", area: "Expenses", title: "Pay bills",
    purpose: "Pay several bills at once; one payment is made per vendor.",
    steps: ["Choose the account to pay from and the date.", "Tick the bills and adjust the amounts for part payments.", "Press \"Record payment\"."],
  },
  {
    path: "/expenses/vendors", area: "Expenses", title: "Vendors",
    purpose: "Every supplier, subcontractor and lender with what you owe them.",
    steps: ["\"New vendor\" adds one: name, TIN, tick \"Registered for GST\" if they are (needed to claim their GST), terms.", "Tick \"Lender\" for an external lender who finances projects.", "Click a vendor to open them."],
  },
  {
    path: "/expenses/vendors/[id]", area: "Expenses", title: "Vendor",
    purpose: "One vendor: details, bills, projects and statement.",
    steps: ["Tabs: Transactions, Projects, Statement, Details.", "Buttons: New bill, Pay bills, Archive."],
  },

  // ── Payroll ──
  {
    path: "/payroll", area: "Payroll", title: "Payroll runs",
    purpose: "Each month's payroll: draft → review → approved (posted to the books) → paid.",
    steps: [
      "Choose the month and pay date and press \"Start payroll run\"; everyone active gets a payslip.",
      "Open the run to check and change payslips.",
    ],
    tips: ["Only admin and finance (or people given payroll permission) see payroll."],
  },
  {
    path: "/payroll/runs/[id]", area: "Payroll", title: "Payroll run",
    purpose: "The payslips of one month.",
    steps: [
      "Each payslip shows earnings, deductions and where the cost goes (projects or overhead). Change pay items or the project split (\"Save split\") while the run is a draft.",
      "Add someone who joined, or \"Take off this run\".",
      "\"Send for review\", then an admin presses \"Approve and post\" — this posts salaries, pension, tax and labour cost to the projects.",
      "Choose the account to pay from and press \"Pay net salaries\".",
      "\"Print payslips\" prints one page per person.",
    ],
  },
  {
    path: "/payroll/employees", area: "Payroll", title: "Employees",
    purpose: "Everyone paid through payroll, directors included.",
    steps: ["\"New employee\" adds one: name, job, site or admin, basic salary, nationality, bank details.", "Click a name to open them."],
  },
  {
    path: "/payroll/employees/[id]", area: "Payroll", title: "Employee",
    purpose: "One person: details, pay items, how their time is split across projects, payslips and salary advances.",
    steps: [
      "Details: edit salary, bank, permit and passport details.",
      "Project split: \"Add a project\" with a percentage; the total must be 100%. Site staff cost goes to those projects.",
      "Salary advances: \"Give advance\" and how much to recover each month.",
    ],
  },
  {
    path: "/payroll/remittances", area: "Payroll", title: "Pension & tax payments",
    purpose: "Pay over the pension and withholding tax held back from pay.",
    steps: ["See what is owed to the pension office and to MIRA.", "Choose what you are paying, the account and date, then \"Record payment\"."],
  },

  // ── Partners ──
  {
    path: "/partners", area: "Partners & financing", title: "Partners & financing",
    purpose: "The Capital Pool, lenders, profit shares and payouts across all projects.",
    steps: [
      "Tiles: principal still owed, returns and shares owed, ready to pay, and blocked.",
      "Payouts awaiting approval: an admin presses \"Approve and pay\" (or \"Turn down…\" with a reason).",
      "People: what each person is owed — principal, financing return and profit share kept apart. Click a name for their statement.",
      "Projects: financing, what is owed and whether payouts are released (and why not).",
    ],
  },
  {
    path: "/partners/[id]", area: "Partners & financing", title: "Partner statement",
    purpose: "One person's statement by project: principal, financing return and profit share — accrued, paid, outstanding — and paying them.",
    steps: [
      "Read the three tiles and the By project table.",
      "Pay out: type an amount against each line (\"All\" fills what is owed), choose the account and date. Lines on blocked projects say why.",
      "An admin's payout is paid at once; anyone else's goes to an admin for approval.",
    ],
    tips: ["Nothing can be paid until the project is completed and the client owes nothing."],
  },
  {
    path: "/partners/distributions", area: "Partners & financing", title: "Distribution history",
    purpose: "Every profit split and every later adjustment, exactly as posted.",
    steps: ["Each card is one split (on completion) or adjustment (bad debt, late cost) with who got what."],
  },

  // ── Banking ──
  {
    path: "/banking", area: "Banking", title: "Banking",
    purpose: "Bank and cash accounts, statement import and transfers.",
    steps: [
      "Each account shows the balance in the books and when it was last reconciled. Click one to work in it.",
      "Import a bank statement (CSV) for an account.",
      "Transfer between accounts: from, to, amount, date → \"Record transfer\".",
      "Bank rules fill in the Add form for statement lines that repeat.",
    ],
  },
  {
    path: "/banking/[accountId]", area: "Banking", title: "Bank account",
    purpose: "One account's register, its imported statement lines, and reconciliation.",
    steps: [
      "Register: every entry with running balance.",
      "Bank statement: each imported line is matched to an entry (\"Match\"), added as a new one (\"Add\"), or excluded. Undo a match if it was wrong.",
      "Reconcile: enter the statement date and ending balance, press \"Start\", tick the cleared lines until the difference is 0, then \"Finish reconciliation\". \"Report\" prints it; the last one can be undone.",
    ],
  },
  {
    path: "/banking/rules", area: "Banking", title: "Bank rules",
    purpose: "Rules that recognise repeating statement lines (bank charges, rent) and fill in the account and contact.",
    steps: ["Enter the text to look for and what to fill in, then \"Add rule\". Turn rules off or delete them in the list."],
  },

  // ── Taxes ──
  {
    path: "/taxes", area: "Taxes", title: "Taxes (GST)",
    purpose: "GST returns by quarter and payroll taxes owed.",
    steps: [
      "The tiles show this quarter's GST so far, the due date, filed-but-unpaid returns and credit carried forward.",
      "Each return is listed with output, input, net and what is still owed. Click one to file or pay it.",
      "Payroll taxes: pension and withholding tax owed, with a link to pay them.",
    ],
  },
  {
    path: "/taxes/gst/[id]", area: "Taxes", title: "GST return",
    purpose: "One quarter's return: the worksheet, the schedules for MIRA, filing and payment.",
    steps: [
      "Check the worksheet (output tax, input tax, net) and the supplies by tax code for the MIRA form.",
      "Download the output and input schedules (CSV) — rows without a TIN are in red.",
      "After filing with MIRA: enter the reference, tick the box and press \"File return\". The quarter locks.",
      "Pay: choose the account, date and amount → \"Record payment\". Part payments are fine.",
    ],
    tips: ["Returns are filed in order. Anything dated in a filed quarter later goes into the next open return, flagged."],
  },

  // ── Reports ──
  {
    path: "/reports", area: "Reports", title: "Reports",
    purpose: "Every statement, schedule and list, grouped; your saved views; and the year-end pack.",
    steps: ["Click a report to run it.", "Saved views open a report with the filters you saved.", "Year-end pack: all statements and schedules for the auditor, to print/PDF or Excel."],
  },
  {
    path: "/reports/[key]", area: "Reports", title: "A report",
    purpose: "One report with its filters, drill-down and exports.",
    steps: [
      "Choose the period (this month, quarter, financial year, year to date, last year, or your own dates) and, where offered, a comparison and filters (project, customer/vendor, account). Press \"Run report\".",
      "Click a figure to see the ledger lines behind it, and click a line to open the document.",
      "CSV, Excel and Print / PDF download or print exactly what is on screen. \"Save view\" keeps these filters under a name.",
    ],
  },

  // ── Accounting ──
  {
    path: "/accounting/chart", area: "Accounting", title: "Chart of accounts",
    purpose: "Every account with its balance.",
    steps: ["Click an account to see its register.", "Add an account with the new-account form (code, name, type, and a parent if it sits under another). System accounts cannot change type.", "\"Show inactive\" lists accounts taken out of use."],
  },
  {
    path: "/accounting/chart/[id]", area: "Accounting", title: "Account register",
    purpose: "Every line posted to one account, with running balance.",
    steps: ["Click an entry to open its document.", "Edit the name or description; untick Active for an account you no longer use (it is hidden from pickers, its history stays)."],
  },
  {
    path: "/accounting/journal", area: "Accounting", title: "Journal entries",
    purpose: "Manual journal entries and opening balances.",
    steps: ["\"New journal entry\" for adjustments; \"Opening balances\" for the day the books start.", "Click a number to see the entry; \"Void…\" reverses one (with a reason)."],
  },
  {
    path: "/accounting/journal/new", area: "Accounting", title: "New journal entry / opening balances",
    purpose: "Post debits and credits by hand.",
    steps: [
      "Enter the date and a memo.",
      "One line per account: debit or credit, and the customer/vendor or project where it belongs. \"Add line\" for more.",
      "A journal must balance (the totals show \"Balanced\"). For opening balances any difference goes to Opening Balance Equity.",
      "Press \"Post\".",
    ],
    tips: ["Customer and vendor balances need the name on the line so their statements are right."],
  },
  {
    path: "/accounting/health", area: "Accounting", title: "Health check",
    purpose: "The 13 checks that prove the books are right (everything balances, ties to the statements, nothing crosses between books).",
    steps: ["Every line should say it passes. If one fails, the detail says what is out and by how much — tell your accountant or developer."],
  },
  {
    path: "/accounting/equipment", area: "Accounting", title: "Equipment register (older screen)",
    purpose: "Tools, machines and vehicles the company owns.",
    steps: ["Add an item with cost and date; the list keeps them."],
    tips: ["Depreciation in the new books is not built yet (see QA report)."],
  },
  {
    path: "/accounting/year-end", area: "Accounting", title: "Year end (older screen)",
    purpose: "Approve the old statements and close the year.",
    steps: ["Follow the steps on the page."],
    tips: ["For the new books use Reports → Year-end pack, and Settings → Accounting → Closing date to lock a year."],
  },

  // ── Other ──
  { path: "/tasks", area: "Other", title: "Tasks & calendar", purpose: "What is due across every project.", steps: ["Add a task with a project and due date; tick it when done."] },
  { path: "/messages", area: "Other", title: "Message center", purpose: "Send an SMS or email to anyone, and see what was sent.", steps: ["Choose who, write the message, send. The history lists what went out."] },
  { path: "/quotations", area: "Other", title: "Quotations", purpose: "Price the work, win it, then invoice it (Live only for now).", steps: ["\"New quotation\", fill in the lines, save; print it with your template and signature.", "Templates and Signatures & stamp set how they look."] },
  { path: "/estimator", area: "Other", title: "Cabinet estimator", purpose: "Price kitchen and cabinet jobs from wall measurements.", steps: ["Enter the walls and units; the cut list, drawings and price follow."] },

  // ── Settings ──
  {
    path: "/settings/company", area: "Settings", title: "Company",
    purpose: "The details every invoice and filing repeats.",
    steps: ["Enter the legal and trade name, TIN, GST registration and number, address, phone, email and bank details. \"Save details\"."],
  },
  {
    path: "/settings/accounting", area: "Settings", title: "Accounting settings",
    purpose: "How the books behave.",
    steps: [
      "Closing date: nothing on or before it can change without an adjustment.",
      "Opening balance date and the month the financial year starts.",
      "How project revenue is recognised; where partners' profit shares are charged; the bill approval limit.",
      "GST: filed monthly or quarterly, and the day it is due. No-pay days in a month.",
      "\"Save settings\". Reset Test book (at the bottom) clears everything in the Test book.",
    ],
    tips: ["Settings are shared by the Live and Test books."],
  },
  {
    path: "/settings/taxes", area: "Settings", title: "Taxes & rates",
    purpose: "GST, pension, withholding tax and BPT rates, each with the date it starts.",
    steps: ["Add a rate or a set of brackets with its start date. A rate already in force cannot change — add a new one from the new date."],
  },
  { path: "/settings/numbering", area: "Settings", title: "Numbering", purpose: "How each kind of document is numbered.", steps: ["Change the prefix, the next number and digits; \"Save\"."], tips: ["Test-book numbers always start with TEST-."] },
  { path: "/settings/currencies", area: "Settings", title: "Currencies", purpose: "Currencies and exchange rates.", steps: ["Add a currency, then its rate to MVR for a date."] },
  {
    path: "/settings/profit-share", area: "Settings", title: "Profit-share schemes",
    purpose: "Who gets what share of project profit, by version.",
    steps: [
      "Each version shows its shares and how many projects use it.",
      "An admin adds a version: name, the date it starts, and each share (financing pool, company, each partner) — it must total 100%.",
      "A version no split has used can be removed.",
    ],
    tips: ["A project uses the version in force on its start date."],
  },
];

/** The help entry for a page address, if there is one. */
export function helpFor(pathname: string): Help | undefined {
  const clean = pathname.replace(/\/$/, "") || "/";
  return HELP.find((h) => new RegExp(`^${h.path.replace(/\[[^\]]+\]/g, "[^/]+")}$`).test(clean));
}

export const AREAS = [...new Set(HELP.map((h) => h.area))];

/** The whole guide as Markdown (docs/USER_GUIDE.md). */
export function guideMarkdown(old: { href: string; label: string; replacedBy: [string, string] }[]) {
  const out = ["# Spruce & Co — how to use each page", "",
    "Each page also has a \"How to use this page\" box at the top, and the Help page lists them all.", ""];
  for (const a of AREAS) {
    out.push(`## ${a}`, "");
    for (const h of HELP.filter((x) => x.area === a)) {
      out.push(`### ${h.title}`, "", `\`${h.path}\` — ${h.purpose}`, "");
      h.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
      if (h.tips?.length) { out.push(""); for (const t of h.tips) out.push(`> ${t}`); }
      out.push("");
    }
  }
  out.push("## Old screens (off the menu)", "", "Kept, Live only, so old figures can be checked before the switch-over.", "");
  for (const o of old) out.push(`- \`${o.href}\` ${o.label} → use **${o.replacedBy[1]}** (\`${o.replacedBy[0]}\`)`);
  return out.join("\n") + "\n";
}
