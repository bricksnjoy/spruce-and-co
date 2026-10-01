# Spruce & Co — how to use each page

Each page also has a "How to use this page" box at the top, and the Help page lists them all.

## Everyday

### Dashboard

`/` — Where the business stands today: cash, who owes what, profit, GST, payroll, payouts, projects and a 12-week cash forecast.

1. Read the four tiles at the top: cash and bank, what customers owe, what you owe vendors (each with the overdue part), and profit this month with the year to date.
2. Check the cash forecast: the line is the cash expected at the end of each of the next 12 weeks. Hover a point to see money in and out that week; "Week by week" opens the full table.
3. Cash by account shows each bank and cash balance; an amber "reconcile" means that account has not been reconciled to the end of last month.
4. The small cards show this quarter's GST and its due date, the next payroll, payouts ready or blocked, and how many accounts need reconciling. Each has a link to its screen.
5. Active projects lists the biggest jobs with contract value, billed and forecast profit. Click one to open it.

> Everything here comes from the ledger of the book you are in (Live or Test — the switch at the top of every page).

### Search

`/search` — Find any document, customer, vendor, project, employee or account.

1. Type in the search box at the top of any page and press Enter: part of a document number (INV/26/004), a name, or an exact amount (12500).
2. Results come grouped: documents, contacts, projects, employees, accounts. Click one to open it.

> An amount matches a document's total exactly, so type it without commas or with them — both work.

### Help

`/help` — This guide: how to use every page, in one place.

1. Pick a page from the list, or open any page and use its "How to use this page" box at the top.

## Projects

### Projects

`/projects` — Every project with its value, billing, cost, forecast profit and stage (active → completed → settled → closed).

1. Use "New project" (or + New → Project) to add one.
2. Read across a row: revised contract value, % billed, collected, cost to date, forecast profit and margin, and what the client still owes.
3. Click a project to open it. Use "Archived" to see projects taken out of the working list.

### New project

`/projects/new` — Set up a project so invoices, bills, payroll and financing can be charged to it.

1. Enter the project name; the code is suggested (SC-001, SC-002 …) and can be changed.
2. Choose the customer (or add one from the form), the start date and the contract value.
3. Choose how revenue is recognised: as billed, by percentage of completion, or the company default.
4. Press "Create project". Budget, variations and billing stages are added on the project's own page.

> The profit-share scheme the project uses is the one in force on its start date.

### Project page

`/projects/[id]` — One project from start to payout, in tabs.

1. Overview: contract value, billed, collected, cost to date, forecast profit, % complete and over/under-billing.
2. Value & budget: set budget lines by category; see budget against actual and committed (open purchase orders). Amber/red warnings mean a category is past 80% or 100%.
3. Bills: every bill on the project. "New bill" opens the bill form in a pop-up. To add many: "Download template", fill one row per bill line (rows with the same vendor and supplier invoice no. make one bill), "Upload filled sheet", check the rows (problems show in red), then "Save". "Download bills (Excel)" gives the bills already added in the same layout — add rows and upload it again; bills already saved are recognised and skipped.
4. Variations: raise a variation; only approved ones change the contract value.
5. Billing plan: stages of the contract; turn a stage into an invoice when it is due.
6. Financing: record money received for the project — a Capital Pool member's contribution or an external lender's loan — and see each source's share of the financing. Choosing "External lender" shows "+ New lender" to add one without leaving the page.
7. Profit split: before completion, a preview of who gets what on the profit to date. Tick the box and "Complete and post split" to complete the project.
8. Payouts: whether payouts are released (the client must owe nothing) and what each person is owed.
9. Transactions: every document posted to the project.

> Buttons at the top: New invoice, New bill (opens the Bills tab with the form), Edit, Archive. "Old view" shows the project as the old screens saw it (Live only).
> Anything posted to a completed project later (a cost, a bad debt) adjusts the split with its own entry and flags the project for review.

### Edit project

`/projects/[id]/edit` — Change a project's name, customer, dates, value or recognition method.

1. Change the fields and press "Save changes".

### Project P&L (older screen)

`/pnl` — The project profit table from the old screens, kept for reference.

1. Read value, variation, GST, expenses and profit per project as the old records have them.

> For figures from the new books use the project's Overview tab or Reports → Profit or loss by project.

## Sales

### Sales & invoices

`/sales` — Every invoice, credit note, sales receipt, payment and deposit, with what is still owed.

1. Use the tabs: All, Invoices, Unpaid, Overdue, Deposits.
2. The status shows draft, sent, part paid, paid, overdue or void.
3. Click a document to open it. New documents come from + New (Invoice, Receive payment, Sales receipt, Credit note, Bank deposit).

### New invoice / credit note / sales receipt

`/sales/new` — Bill a customer (invoice), reduce what they owe (credit note), or record a sale paid on the spot (sales receipt).

1. Choose the customer; the due date follows their payment terms. Choose the project if the work is for one.
2. For a sales receipt, choose the account the money went into (or leave it in Undeposited Funds to bank later).
3. Add lines: description, quantity and rate (or just an amount), GST code and income account. The total with GST shows as you type.
4. Press "Save invoice" (or credit note / receipt). It is posted to the books at once.

> Save as draft if it is not final; a draft posts nothing.
> Foreign currency: choose USD and enter the MVR rate.

### Sales document

`/sales/[id]` — One invoice, credit note, receipt or payment: its lines, GST, payments applied and what is still owed.

1. Print / PDF opens the tax invoice to print or save.
2. Mark sent records that it went to the customer.
3. Receive payment opens a payment for this customer.
4. Edit changes it (the new figures replace the old; the change is kept in the audit log). Void keeps it on record but reverses it.

> A document with payments applied cannot be voided until the payments are removed or voided.

### Edit sales document

`/sales/[id]/edit` — Correct an invoice, credit note or receipt.

1. Change what is wrong and press "Save changes"; the posting is redone.

> A document dated in a filed GST quarter or before the closing date cannot change silently: the GST difference goes into the next open return.

### Receive payment

`/sales/payments/new` — Record money from a customer and apply it to their invoices.

1. Choose the customer; their open invoices appear.
2. Enter the date, the amount received and the account it went into.
3. Type how much goes to each invoice ("Apply to …"). Anything left over is held as the customer's credit.
4. Press "Save payment".

### Bank deposit

`/sales/deposits/new` — Move receipts from Undeposited Funds into the bank, the way the bank statement shows them.

1. Choose the bank account and date, tick the receipts in the deposit, and press "Save deposit".

### Client advances

`/sales/advances` — Money received before invoicing, held as Customer Advances until applied to invoices.

1. Record an advance: customer, date, amount and account, then "Save advance".
2. When invoices are raised, use the Apply form on this page: choose the customer, type how much of the advance goes to each invoice, and press "Apply advance".

### Customers

`/sales/customers` — Every customer with what they owe and what is overdue.

1. "New customer" adds one: name, TIN, GST registration, payment terms, currency.
2. Tabs: Active, Needs review (copied from the old lists — confirm each is real), Archived.
3. Click a customer to open them.

### Customer

`/sales/customers/[id]` — One customer: their details, documents, projects and statement.

1. Tabs: Transactions, Projects, Statement (choose From/To, then Print / PDF), Details (edit).
2. Buttons: New invoice, Receive payment. Archive takes them out of the lists without deleting anything.

## Expenses

### Bills & expenses

`/expenses` — Every bill, expense, vendor credit, purchase order and bill payment.

1. Use the tabs: All, Bills, Expenses, Unpaid, Overdue.
2. Click one to open it. New ones come from + New (Bill, Pay bills, Expense, Vendor credit, Purchase order).

### New bill / expense / vendor credit / purchase order

`/expenses/new` — Record what you owe a vendor (bill), something already paid (expense), a vendor's credit, or an order not yet billed.

1. Optional: upload a photo of the bill and press "Read the photo" to fill in the vendor, TIN, invoice number and lines.
2. Choose the vendor and the project (or overhead). For an expense, choose the account it was paid from.
3. Enter the supplier's TIN, tax invoice number and date — needed to claim the GST.
4. Add lines: account, description, amount before GST, the supplier's GST figure, and the project. Untick "claimable" when the GST cannot be claimed (it then becomes cost).
5. Press "Save bill" (or expense …).

> Bills above the approval limit (Settings → Accounting) wait for an admin's approval before they post.

### Bill or expense

`/expenses/[id]` — One document: lines, GST, payments and what is still owed.

1. Pay opens Pay bills for it. Approve and post appears for an admin when a bill is waiting for approval.
2. A vendor credit shows "Apply" against the vendor's open bills. A purchase order has "Turn into a bill" and Close/Reopen.
3. Edit changes it; Void reverses it (the reason is kept).

### Edit bill or expense

`/expenses/[id]/edit` — Correct a bill, expense, credit or order.

1. Change what is wrong and press "Save changes".

### Pay bills

`/expenses/pay` — Pay several bills at once; one payment is made per vendor.

1. Choose the account to pay from and the date.
2. Tick the bills and adjust the amounts for part payments.
3. Press "Record payment".

### Vendors

`/expenses/vendors` — Every supplier, subcontractor and lender with what you owe them.

1. "New vendor" adds one: name, TIN, tick "Registered for GST" if they are (needed to claim their GST), terms.
2. Tick "Lender" if this vendor also lends money for projects; it then shows on the Lenders page too.
3. Click a vendor to open them.

### Vendor

`/expenses/vendors/[id]` — One vendor: details, bills, projects and statement.

1. Tabs: Transactions, Projects, Statement, Details.
2. Buttons: New bill, Pay bills, Archive.

## Payroll

### Payroll runs

`/payroll` — Each month's payroll: draft → review → approved (posted to the books) → paid.

1. Choose the month and pay date and press "Start payroll run"; everyone active gets a payslip.
2. Open the run to check and change payslips.

> Only admin and finance (or people given payroll permission) see payroll.

### Payroll run

`/payroll/runs/[id]` — The payslips of one month.

1. Each payslip shows earnings, deductions and where the cost goes (projects or overhead). Change pay items or the project split ("Save split") while the run is a draft.
2. Add someone who joined, or "Take off this run".
3. "Send for review", then an admin presses "Approve and post" — this posts salaries, pension, tax and labour cost to the projects.
4. Choose the account to pay from and press "Pay net salaries".
5. "Print payslips" prints one page per person.

### Employees

`/payroll/employees` — Everyone paid through payroll, directors included.

1. "New employee" adds one: name, job, site or admin, basic salary, nationality, bank details.
2. Click a name to open them.

### Employee

`/payroll/employees/[id]` — One person: details, pay items, how their time is split across projects, payslips and salary advances.

1. Details: edit salary, bank, permit and passport details.
2. Project split: "Add a project" with a percentage; the total must be 100%. Site staff cost goes to those projects.
3. Salary advances: "Give advance" and how much to recover each month.

### Pension & tax payments

`/payroll/remittances` — Pay over the pension and withholding tax held back from pay.

1. See what is owed to the pension office and to MIRA.
2. Choose what you are paying, the account and date, then "Record payment".

## Partners & financing

### Partners & financing

`/partners` — The Capital Pool, lenders, profit shares and payouts across all projects.

1. Tiles: principal still owed, returns and shares owed, ready to pay, and blocked.
2. Payouts awaiting approval: an admin presses "Approve and pay" (or "Turn down…" with a reason).
3. People: what each person is owed — principal, financing return and profit share kept apart. Click a name for their statement.
4. Projects: financing, what is owed and whether payouts are released (and why not).

### Lenders

`/partners/lenders` — External lenders (banks, friends, investors) who finance projects: what each lent, what has been repaid and what is still owed.

1. "New lender" adds one: name, phone, bank details. The lender is ticked already. You land on their page.
2. The table shows each lender's projects, the amount lent, repaid, principal still owed and their financing return owed. Click a name to open their page.
3. To record a loan: on the lender's page choose the project under "Record a loan" (or use the project's Financing tab and pick "External lender").
4. Archived lenders are under "Archived"; archive one from their page.

> Lenders are repaid their principal plus their share of the 20% financing pool, once the project is completed and the client has paid in full. They get no fixed profit share and no interest (P5).
> A lender who also sells you goods can be ticked as a vendor too (Details on their page), and appears on both lists.

### Partner or lender page

`/partners/[id]` — One person's statement by project: principal, financing return and profit share — accrued, paid, outstanding — the money received from them, and paying them.

1. Read the three tiles and the By project table.
2. Loans and money received lists each loan or contribution with its project.
3. For a lender, "Record a loan": choose the project and its Financing tab opens with the lender picked.
4. Details at the bottom: change their name, phone, bank details, or tick them as a customer or vendor too.
5. Pay out: type an amount against each line ("All" fills what is owed), choose the account and date. Lines on blocked projects say why.
6. An admin's payout is paid at once; anyone else's goes to an admin for approval.

> Nothing can be paid until the project is completed and the client owes nothing.

### Distribution history

`/partners/distributions` — Every profit split and every later adjustment, exactly as posted.

1. Each card is one split (on completion) or adjustment (bad debt, late cost) with who got what.

## Banking

### Banking

`/banking` — Bank and cash accounts, statement import and transfers.

1. Each account shows the balance in the books and when it was last reconciled. Click one to work in it.
2. Import a bank statement (CSV) for an account.
3. Transfer between accounts: from, to, amount, date → "Record transfer".
4. Bank rules fill in the Add form for statement lines that repeat.

### Bank account

`/banking/[accountId]` — One account's register, its imported statement lines, and reconciliation.

1. Register: every entry with running balance.
2. Bank statement: each imported line is matched to an entry ("Match"), added as a new one ("Add"), or excluded. Undo a match if it was wrong.
3. Reconcile: enter the statement date and ending balance, press "Start", tick the cleared lines until the difference is 0, then "Finish reconciliation". "Report" prints it; the last one can be undone.

### Bank rules

`/banking/rules` — Rules that recognise repeating statement lines (bank charges, rent) and fill in the account and contact.

1. Enter the text to look for and what to fill in, then "Add rule". Turn rules off or delete them in the list.

## Taxes

### Taxes (GST)

`/taxes` — GST returns by quarter and payroll taxes owed.

1. The tiles show this quarter's GST so far, the due date, filed-but-unpaid returns and credit carried forward.
2. Each return is listed with output, input, net and what is still owed. Click one to file or pay it.
3. Payroll taxes: pension and withholding tax owed, with a link to pay them.

### GST return

`/taxes/gst/[id]` — One quarter's return: the worksheet, the schedules for MIRA, filing and payment.

1. Check the worksheet (output tax, input tax, net) and the supplies by tax code for the MIRA form.
2. Download the output and input schedules (CSV) — rows without a TIN are in red.
3. After filing with MIRA: enter the reference, tick the box and press "File return". The quarter locks.
4. Pay: choose the account, date and amount → "Record payment". Part payments are fine.

> Returns are filed in order. Anything dated in a filed quarter later goes into the next open return, flagged.

## Reports

### Reports

`/reports` — Every statement, schedule and list, grouped; your saved views; and the year-end pack.

1. Click a report to run it.
2. Saved views open a report with the filters you saved.
3. Year-end pack: all statements and schedules for the auditor, to print/PDF or Excel.

### A report

`/reports/[key]` — One report with its filters, drill-down and exports.

1. Choose the period (this month, quarter, financial year, year to date, last year, or your own dates) and, where offered, a comparison and filters (project, customer/vendor, account). Press "Run report".
2. Click a figure to see the ledger lines behind it, and click a line to open the document.
3. CSV, Excel and Print / PDF download or print exactly what is on screen. "Save view" keeps these filters under a name.

## Accounting

### Chart of accounts

`/accounting/chart` — Every account with its balance.

1. Click an account to see its register.
2. Add an account with the new-account form (code, name, type, and a parent if it sits under another). System accounts cannot change type.
3. "Show inactive" lists accounts taken out of use.

### Account register

`/accounting/chart/[id]` — Every line posted to one account, with running balance.

1. Click an entry to open its document.
2. Edit the name or description; untick Active for an account you no longer use (it is hidden from pickers, its history stays).

### Journal entries

`/accounting/journal` — Manual journal entries and opening balances.

1. "New journal entry" for adjustments; "Opening balances" for the day the books start.
2. Click a number to see the entry; "Void…" reverses one (with a reason).

### New journal entry / opening balances

`/accounting/journal/new` — Post debits and credits by hand.

1. Enter the date and a memo.
2. One line per account: debit or credit, and the customer/vendor or project where it belongs. "Add line" for more.
3. A journal must balance (the totals show "Balanced"). For opening balances any difference goes to Opening Balance Equity.
4. Press "Post".

> Customer and vendor balances need the name on the line so their statements are right.

### Health check

`/accounting/health` — The 13 checks that prove the books are right (everything balances, ties to the statements, nothing crosses between books).

1. Every line should say it passes. If one fails, the detail says what is out and by how much — tell your accountant or developer.

### Equipment register (older screen)

`/accounting/equipment` — Tools, machines and vehicles the company owns.

1. Add an item with cost and date; the list keeps them.

> Depreciation in the new books is not built yet (see QA report).

### Year end (older screen)

`/accounting/year-end` — Approve the old statements and close the year.

1. Follow the steps on the page.

> For the new books use Reports → Year-end pack, and Settings → Accounting → Closing date to lock a year.

## Other

### Tasks & calendar

`/tasks` — What is due across every project.

1. Add a task with a project and due date; tick it when done.

### Message center

`/messages` — Send an SMS or email to anyone, and see what was sent.

1. Choose who, write the message, send. The history lists what went out.

### Quotations

`/quotations` — Price the work, win it, then invoice it (Live only for now).

1. "New quotation", fill in the lines, save; print it with your template and signature.
2. Templates and Signatures & stamp set how they look.

### Cabinet estimator

`/estimator` — Price kitchen and cabinet jobs from wall measurements.

1. Enter the walls and units; the cut list, drawings and price follow.

## Settings

### Company

`/settings/company` — The details every invoice and filing repeats.

1. Enter the legal and trade name, TIN, GST registration and number, address, phone, email and bank details. "Save details".

### Accounting settings

`/settings/accounting` — How the books behave.

1. Closing date: nothing on or before it can change without an adjustment.
2. Opening balance date and the month the financial year starts.
3. How project revenue is recognised; where partners' profit shares are charged; the bill approval limit.
4. GST: filed monthly or quarterly, and the day it is due. No-pay days in a month.
5. "Save settings". Reset Test book (at the bottom) clears everything in the Test book.

> Settings are shared by the Live and Test books.

### Taxes & rates

`/settings/taxes` — GST, pension, withholding tax and BPT rates, each with the date it starts.

1. Add a rate or a set of brackets with its start date. A rate already in force cannot change — add a new one from the new date.

### Numbering

`/settings/numbering` — How each kind of document is numbered.

1. Change the prefix, the next number and digits; "Save".

> Test-book numbers always start with TEST-.

### Currencies

`/settings/currencies` — Currencies and exchange rates.

1. Add a currency, then its rate to MVR for a date.

### Profit-share schemes

`/settings/profit-share` — Who gets what share of project profit, by version.

1. Each version shows its shares and how many projects use it.
2. An admin adds a version: name, the date it starts, and each share (financing pool, company, each partner) — it must total 100%.
3. A version no split has used can be removed.

> A project uses the version in force on its start date.

## Old screens (off the menu)

Kept, Live only, so old figures can be checked before the switch-over.

- `/invoices` Invoices (old) → use **Sales & invoices** (`/sales`)
- `/capital-pool` Capital Pool (old) → use **Partners & financing** (`/partners`)
- `/investors` Investors (old) → use **Partners & financing** (`/partners`)
- `/financing` Project Financing (old) → use **Partners & financing** (`/partners`)
- `/internal` Internal Account (old) → use **Partners & financing** (`/partners`)
- `/accounting` Accounting overview (old) → use **Dashboard** (`/`)
- `/accounting/ledger` Ledger (old) → use **General Ledger report** (`/reports/general-ledger`)
- `/accounting/audit` Self-audit (old) → use **Health check** (`/accounting/health`)
- `/accounting/statements` Financial statements (old) → use **Reports** (`/reports`)
- `/accounting/bank` Bank reconciliation (old) → use **Banking** (`/banking`)
- `/accounting/tax` Tax (old) → use **Taxes (GST)** (`/taxes`)
- `/gst` GST Input Schedule (old) → use **Taxes (GST)** (`/taxes`)
- `/pnl` Project P&L (old) → use **Reports (project profit) and each project's Overview tab** (`/reports`)
- `/profit-share` Profit Share (old) → use **Profit-share schemes** (`/settings/profit-share`)
