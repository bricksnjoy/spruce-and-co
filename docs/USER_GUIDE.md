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

> Everything here comes from the ledger.

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
3. The colour down the left side of a row is its stage: blue active, amber completed with the client still owing, green settled (payouts due), grey closed.
4. Use the filter above the list to show one stage only; the totals at the top follow it. "Archived" shows projects taken out of the working list, and (admin) "Deleted" the projects deleted in the last 30 days, each with "Restore" to put it back with everything it had.
5. Click a project to open it.

### New project

`/projects/new` — Set up a project so invoices, receipts, payroll and financing can be charged to it.

1. Enter the project name; the code is suggested (SC-001, SC-002 …) and can be changed.
2. Choose the customer (or add one from the form), the start date and the project value. GST is worked out from the value at the standard rate in Settings → Taxes.
3. Choose how revenue is recognised: as billed, by percentage of completion, or the company default.
4. Press "Create project". Variations and billing stages are added on the project's own page.

> The profit-share scheme the project uses is the one in force on its start date.

### Project page

`/projects/[id]` — One project from start to payout, in tabs.

1. Overview: contract value and variations (with GST), profit (income before GST less costs), cost to date, billed (with GST) and collected.
2. Variations: raise a variation with its details and amount; only approved ones change the contract value.
3. Expenses: everything bought for the project. "New receipt" opens the receipt form in a pop-up; it is saved as paid from the account you pick under "Paid from" (pick "Not paid yet" when it is still to pay). To add many: "Download receipts (Excel)", fill one row per receipt (Date, Shop, Invoice no., Category, Amount, Discount, GST, Total; categories are on the Categories sheet and set the account for you), "Upload filled sheet", choose the account they were "Paid from" (receipts are saved as paid on their date; pick "Not paid yet" for ones still to pay), pick the right shop for any name not on file (or add it as new), check the rows (problems show in red), then "Save". The sheet comes with the receipts already added (blank when there are none); receipts already saved are recognised and skipped. "+ Other cost (no vendor)" records money already paid with no supplier receipt (transport, pickups, site labour paid in cash): pick the category (e.g. Freight & Logistics, Direct Labour, Site Expenses) and the account it was paid from. A receipt not paid yet shows "Overdue" once past its due date (with no payment terms, the day it is dated); mark it paid from its status (pick the account it was paid from), or use "Mark all as paid"; each is paid on its own date. Salaries reach a project through Payroll: set each employee's project split, and each payslip charges its share to the projects.
4. Billing plan: what is still to come from the client (contract value, invoiced, received, still to receive), then the stages of the contract; turn a stage into an invoice when it is due ("Delete invoice" beside it removes the invoice and frees the stage). Stage amounts are before GST: when the project carries GST (or the company is GST registered) each stage shows its GST and the total with GST, and its invoice adds the GST on top.
5. Financing: record money for the project and see each source's share of the financing. "Capital Pool" (admin) lists each director's account and the company's own money with what each has; type how much comes from each — e.g. company 100,000, Mujahid 40,000, Muaz 25,000, Mushahid 25,000 and Mariyam 10,000 — and none can be more than it has. Each director's part leaves their director's account and becomes their Capital Pool money in the project. "Lender" records a loan from a lender, or from a director added on Lenders, and shows "+ New lender" to add one without leaving the page. The company's own part is a source like the rest: it shows as repaid once the client has paid in full, and its share of the financing pool (e.g. 35,000 of 40,000 earns 35/40 of the 20 %) is shown on Profit split; both stay with the company, so nothing is posted.
6. Profit split: before completion, a preview of who gets what on the profit to date. Tick the box and "Complete and post split" to complete the project.
7. Payouts: whether payouts are released (the client must owe nothing) and what each person is owed.
8. Transactions: every document posted to the project.

> The ⋯ button at the top: Edit project, Archive project; for an admin, Undo completion (on a completed project) and Delete project…, which takes every document, payment, financing entry and payout of the project out of the books after you type its code. A project is refused while something of it also belongs to another project, a payroll run charged labour to it, it is in a filed GST return, or a director's account has already used its money. It can be restored for 30 days from Projects → Deleted.
> Anything posted to a completed project later (a cost, a bad debt) adjusts the split with its own entry and flags the project for review.

### Edit project

`/projects/[id]/edit` — Change a project's name, customer, dates, value or recognition method.

1. Change the fields and press "Save changes".

## Sales

### Sales & invoices

`/sales` — Every invoice, credit note, sales receipt, payment and deposit, with what is still owed.

1. Use the tabs: All, Invoices, Unpaid, Overdue, Deposits.
2. The status shows draft, sent, part paid, paid, overdue or void.
3. Click a document to open it. New documents come from + New (Invoice, Receive payment, Sales receipt, Credit note, Bank deposit).

### New invoice / credit note / sales receipt

`/sales/new` — Bill a customer (invoice), reduce what they owe (credit note), or record a sale paid on the spot (sales receipt).

1. Choose the customer; the due date follows their payment terms. Type a number of days to set it from the invoice date (10 days from 26 Oct is 5 Nov), or pick the date. Choose the project if the work is for one.
2. For a sales receipt, choose the account the money went into (or leave it in Undeposited Funds to bank later).
3. Fill in the Quotation no., AGR no. and PO no. as they should print in the invoice header.
4. Add lines: item no. (1.1, 2.1 …), description, quantity, unit and rate (or just an amount), GST code and income account. A line with only an item no. and description is a heading: a letter (A, B) prints on a grey band as a section, 1.0 prints bold. The total with GST shows as you type.
5. "Note on the document" prints centred at the top of the table, one line per line; the second line prints large and underlined as the job's title.
6. The printed invoice follows the paper layout: Sub Total, Less Advance Payment, Less Retention Payment, Taxable Amount, GST and the Grand Total in words, then Authorized by / Invoice Received by, the terms and Payment Received by. The terms and the footer line come from the invoice template (Quotations → Templates).
7. Under "Signed by", pick who signs this invoice and whether the company stamp goes on; it starts from the invoice template's choice. Signatures are uploaded under Quotations → Signatures & stamp.
8. Press "Save invoice" (or credit note / receipt). It is posted to the books at once.

> Save as draft if it is not final; a draft posts nothing.
> Foreign currency: choose USD and enter the MVR rate.

### Sales document

`/sales/[id]` — One invoice, credit note, receipt or payment: its lines, GST, payments applied and what is still owed.

1. Print / PDF opens the tax invoice to print or save.
2. Mark sent records that it went to the customer.
3. Receive payment opens a payment for this customer.
4. Edit changes it (the new figures replace the old; the change is kept in the audit log). Void keeps it on record but reverses it.
5. Delete… removes an invoice, credit note or sales receipt from everything: Sales, the customer, the project and the reports; its billing stage can be invoiced again. Payments received for it are deleted with it too, unless you untick that (then they stay as the customer's credit). Restore it from the page (Sales → Deleted) within 30 days.

> A document with payments applied cannot be voided until the payments are removed or voided; Delete… handles them for you.

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

### Receipts & expenses

`/expenses` — Every receipt, expense, vendor credit, purchase order and payment to a vendor.

1. Use the tabs: All, Receipts, Expenses, Unpaid, Overdue.
2. Click one to open it. New ones come from + New (Receipt, Pay vendors, Expense, Vendor credit, Purchase order).

### New receipt / expense / vendor credit / purchase order

`/expenses/new` — Record what you bought from a vendor (receipt), something paid with no vendor (expense), a vendor's credit, or an order not yet bought.

1. Optional: choose a photo of the receipt and press "Fill in from the photo" to fill in the vendor, TIN, invoice number and lines.
2. Choose the vendor, the project (or overhead), the date and "Paid from" (the account it was paid from; it is saved as paid). A vendor not on the list: pick "+ Add a new vendor…", type the name and press "Add vendor".
3. Labour or anything paid on the spot needs no vendor: leave it on "No vendor". To pay a vendor later, pick "Not paid yet" (the vendor is then needed and it gets a due date).
4. Under "What was bought" add lines: account, description, amount before GST and the GST charged. Labour has no GST. Tick "Quantity × rate, and a project per line" when you need those.
5. When the vendor charges GST, the Tax invoice box appears: enter the supplier's TIN and tax invoice number to claim the GST back (untick "claim it back" when it cannot be claimed; it then becomes cost).
6. Currency, reference and a note are under "More details".
7. Press "Save receipt" (or expense …).

> Receipts above the approval limit (Settings → Accounting) wait for an admin's approval before they post; mark them paid once approved.

### Receipt or expense

`/expenses/[id]` — One document: lines, GST, payments and what is still owed.

1. Pay opens Pay vendors for a receipt not paid yet. Approve and post appears for an admin when a receipt is waiting for approval.
2. A vendor credit shows "Apply" against the vendor's unpaid receipts. A purchase order has "Turn into a receipt" and Close/Reopen.
3. Edit changes it; Void reverses it (the reason is kept).

### Edit receipt or expense

`/expenses/[id]/edit` — Correct a receipt, expense, credit or order.

1. Change what is wrong and press "Save changes".

### Pay vendors

`/expenses/pay` — Pay several receipts not paid yet at once; one payment is made per vendor.

1. Choose the account to pay from and the date.
2. Tick the receipts and adjust the amounts for part payments.
3. Press "Record payment".

### Vendors

`/expenses/vendors` — Every supplier, subcontractor and lender with what you owe them.

1. "New vendor" adds one: name, TIN, tick "Registered for GST" if they are (needed to claim their GST), terms.
2. Tick "Lender" if this vendor also lends money for projects; it then shows on the Lenders page too.
3. Click a vendor to open them.

### Vendor

`/expenses/vendors/[id]` — One vendor: details, receipts, projects and statement.

1. Tabs: Transactions, Projects, Statement, Details.
2. Buttons: New receipt, Pay vendors, Archive.

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
3. Directors' accounts: for each director, what they have invested in projects, what they have earned on projects not yet completed and paid for, what is waiting for their choice, and what is in their director's account (kept in the company); and the company's own money: bank and cash less everything it owes (directors, lenders, GST, vendors, salaries). A project's money (the client's payments and its financing) stays in the project until it is completed and paid for; then its profit is split and the company's part becomes its own. Kept money and the company's own money can finance the next project. Click a name for their page.
4. Lenders: what each external lender is owed — principal and financing return — and what is ready to pay.
5. Projects: financing, what is owed and whether payouts are released (and why not).

### Lenders

`/partners/lenders` — External lenders (banks, friends, investors) who finance projects: what each lent, what has been repaid and what is still owed.

1. "New lender" adds one: name, phone, bank details. The lender is ticked already. You land on their page.
2. The table shows each lender's projects, the amount lent, repaid, principal still owed and their financing return owed. Click a name to open their page.
3. To record a loan: on the lender's page choose the project under "Record a loan" (or use the project's Financing tab and pick "Lender").
4. Archived lenders are under "Archived"; archive one from their page.

> Lenders are repaid their principal plus their share of the 20% financing pool, once the project is completed and the client has paid in full. They get no fixed profit share and no interest (P5).
> A lender who also sells you goods can be ticked as a vendor too (Details on their page), and appears on both lists.

### Partner or lender page

`/partners/[id]` — One person's money, in the order it moves: what they lent, getting the loan back, and their earnings (financing return and profit share).

1. The tiles: loans still to repay, earnings still to settle, and (a director) what is in their director's account.
2. Each project has two steps. 1 Loan: once the client has paid, "Repay loan" (a director: "Pay back" or "Keep in the company"). If the client has not paid yet, an admin can "Repay from the Capital Pool": type how much comes from each director's account and from the company's own money. The Capital Pool gets it back from the project when the client pays, and earns no share.
3. 2 Earnings: once the project is finished, the client has paid and every loan on it is repaid, "Take it out" pays it from a bank or cash account; a director can "Keep in the company" instead, into their director's account. The financing return is settled first, then the profit share.
4. Director's account: money kept in the company. An admin can "Take money out" or "Reinvest in a project".
5. History: everything lent, repaid, paid out and kept, newest first. A payout waiting for approval can be approved (admin) or turned down there.
6. Settled projects fold away at the bottom of Projects. "Account by project" opens the same figures as a table.

> An admin's payment happens at once; anyone else's goes to an admin for approval.
> Loans come first: no earnings leave a project while a loan to it is still owed.

### Distribution history

`/partners/distributions` — Every profit split and every later adjustment, exactly as posted.

1. Each card is one split (on completion) or adjustment (bad debt, late cost) with who got what.

## People

### Accounts

`/people/accounts` — The company's and each partner's account, one line per project.

1. Each account shows its balance: for a partner, what they are owed on projects plus (a director) their director's account; for the company, its own money. Tap one to open it.
2. Company: each completed project's profit, what goes to the partners and what the company keeps.
3. Each partner or lender: what they lent and what has been repaid, the financing return and profit share earned, what has been paid out, and what is still owed.
4. Loans are repaid first; the return and profit share are paid after. Open a person's statement to pay them out.

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

### Equipment register

`/accounting/equipment` — Tools, machines and vehicles the company owns.

1. Add an item with cost and date; the list keeps them.

> Depreciation in the new books is not built yet (see QA report).

## Other

### Tasks & calendar

`/tasks` — What is due across every project.

1. Add a task with a project and due date; tick it when done.
2. The calendar shows the month: each day lists its open tasks, milestones and bid dates (on a phone, coloured counts). Use ‹ › for the months either side and "This month" to come back.

### Message center

`/messages` — Send an SMS or email to anyone, and see what was sent.

1. Choose who, write the message, send. The history lists what went out.

### Bids

`/bids` — Tenders the company is chasing, from registering to won or lost.

1. "+ New bid": the bid's name, the company that put it out, where the work is (location), the Gazette link, the pre-bid meeting (compulsory or optional), the submission deadline and when the papers should be ready (blank: 2 days before the deadline).
2. The tabs filter by stage: Registered, Pre-bid meeting, Papers ready, Bid submitted, Bid won, Bid lost.
3. The meeting and deadline show on Tasks & Calendar.

> In a Telegram group with topics, everything about bids goes to one topic (Bid timelines); a command is answered in the topic it was typed in.
> When Telegram is set up, the company group is told about each new bid, each stage change and any change to its dates: the stage in bold, then the bid's name and company, its pre-bid meeting (when there is one), the submission date in bold, the location and the Gazette notice. A new bid or stage change also lists every bid now at that stage.
> Every evening at 8 PM the group gets a bid reminder: tomorrow's pre-bid meetings (when there are any), the bids with papers to prepare (papers ready by, and submission, counted down: in 4 days, tomorrow, TODAY, overdue by 1 day), the bids with papers ready awaiting submission, and how many bids are open. Its buttons show the calendar, the list and every bid by stage.
> Under the 8 PM reminder the bot asks who is going to each pre-bid meeting tomorrow and who is submitting each set of papers that is ready: tap a name (tap again to take it off), or "✋ Me". The names are the people the bot has seen in the group: its admins, anyone who joins, writes a command or taps a button (Telegram does not let a bot list a group's members). At 9 PM, anything still without a name calls everyone in the group. The bid's page shows who was picked.
> Two hours before each pre-bid meeting and each submission (of a bid not yet submitted), the group gets "Reminder to attend the pre bid meeting" or "…the bid submission meeting" with the bid's name, date and time, location, and whoever is assigned called by name (everyone, when no one is).
> In the group, /bids shows every bid by stage, /calendar the bid dates on a calendar, /list the upcoming dates as a list, and /reminder sends the 8 PM reminder (with its questions) straight away, to check it. An admin's "Post board to Telegram" posts the board with its buttons and connects these commands.

### Bid

`/bids/[id]` — One bid: its details, its stage and its history.

1. Press a stage to move the bid along; a note typed first goes with it, to the history and the Telegram group.
2. "Add a note" records something on the history only.
3. "Edit" changes the details and dates.

### Quotations

`/quotations` — Price the work, win it, then invoice it.

1. "New quotation", fill in the lines, save (type the days it is valid for, or pick the date); print it with your template and signature.
2. Mark it won, then "Convert to invoice" for a percentage or an amount: the invoice opens in Sales filled in, with the quotation number as its reference. Save it to post it.
3. Templates and Signatures & stamp set how they look; the signer and stamp of the invoice template also go on printed invoices.
4. Quotations print in the boxed layout: a ruled grid with Job No., Qty, Unit, Rate and Amount, the grand total in words, "Quotation Received by", the customer's confirmation box and the conditions. Templates → Layout switches a template back to Modern.

### Cabinet estimator

`/estimator` — Price kitchen and cabinet jobs from wall measurements.

1. Enter the walls and units; the cut list, drawings and price follow.

### Board cut planner

`/cut-planner` — How the parts of a piece of furniture come out of 8 × 4 ft boards, and how many boards to buy.

1. Type the parts in the box, the way you would say them, and press Enter: "Table leg: 2ft x 2in x 2in times 4, Table top: 3 x 4 ft". A unit written once covers the sizes before it, so 3 x 4 ft is 3 ft by 4 ft. Split parts with commas or new lines; the line under the box shows how each one reads.
2. Or add a part to the list and fill in its name, length, width, thickness (blank means as thick as the board — a table top needs only two sizes) and how many. Each part has its own unit (mm, inches, feet or cm); "New parts in" at the top sets the one new parts start with and the unit the results are shown in.
3. Set the board: 8ft by 4ft unless yours is different, its thickness, the saw cut, and the price per board if you want the cost.
4. Read the result: boards needed, pieces to cut, how much wood is used, a drawing of each board with every piece in its colour, and the cut list. "Print" gives the drawings and cut list on paper.

> With a board thickness set, a part thicker than the board — a 2in leg from 18mm board — is cut in layers to glue up, and the cut list says so.
> Untick "Pieces may be turned to fit" to keep the grain running along every part.
> The list is saved to your account as you type, so it opens on your phone, PC or any device you sign in on. Each person has their own list. It is not part of the books.
> If the list was changed on another device while this page was open, you are asked which one to keep.

## Settings

### Company

`/settings/company` — The details every invoice and filing repeats.

1. Enter the legal and trade name, TIN, GST registration and number, address, phone, email and bank details. "Save details".

### Accounting settings

`/settings/accounting` — How the books behave.

1. Closing date: nothing on or before it can change without an adjustment.
2. Opening balance date and the month the financial year starts.
3. How project revenue is recognised; where partners' profit shares are charged; the receipt approval limit.
4. GST: filed monthly or quarterly, and the day it is due. No-pay days in a month.
5. "Save settings".

### Taxes & rates

`/settings/taxes` — GST, pension, withholding tax and BPT rates, each with the date it starts.

1. Add a rate or a set of brackets with its start date. A rate already in force cannot change — add a new one from the new date.

### Numbering

`/settings/numbering` — How each kind of document is numbered.

1. Change the prefix, the next number and digits; "Save".

### Currencies

`/settings/currencies` — Currencies and exchange rates.

1. Add a currency, then its rate to MVR for a date.

### Profit-share schemes

`/settings/profit-share` — Who gets what share of project profit, by version.

1. Each version shows its shares and how many projects use it.
2. An admin adds a version: name, the date it starts, and each share (financing pool, company, each partner) — it must total 100%.
3. A version no split has used can be removed.

> A project uses the version in force on its start date.
