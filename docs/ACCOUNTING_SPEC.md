# Spruce & Co — QuickBooks-Style Accounting Rebuild

You are working in the Spruce & Co Pvt Ltd codebase, a construction company in the Maldives. Your job is to restructure this app into a complete **double-entry accounting system that works and feels like QuickBooks Online**. It must cover:

- project value and job costing
- payroll
- quarterly GST (output tax and input tax)
- full financial statements and reports
- Spruce & Co's project financing and profit-share model

Work through the phases below in order. **At every ⛔ checkpoint, stop and wait for my reply.** Do not invent business rules. If something isn't covered here, ask me.

---

## Ground rules

- Before changing anything, create a new git branch: `rebuild/accounting`. Commit after every completed step, with clear messages.
- Export or back up all existing data before any migration. Migrations must be non-destructive and reversible. Never drop tables or delete data without my explicit approval.
- Stay on the existing stack. If you think it should change, explain why and ask first.
- **Money is never a float.** Store amounts as integer laari (MVR × 100) or `numeric(18,2)`. The home currency is MVR.
- **Rates are never hardcoded.** GST, pension, and withholding-tax rates live in settings, each with an effective date.
- All posting and calculation logic runs server-side, in a database function or server route. It never runs in the browser.
- Save this file as `docs/ACCOUNTING_SPEC.md`. Keep `docs/DECISIONS.md` (my answers) and `docs/QA_REPORT.md` (test results) up to date as you go.

---

## Phases

### Phase 0 — Audit (no code changes)

1. Read the entire codebase. Document the stack, folder structure, database schema, routes and pages, existing features, auth and roles, and env/config.
2. Run install, build, type-check, lint, and all existing tests. Record every error and warning.
3. Hunt for glitches, including:
   - broken routes, dead buttons, and unhandled errors
   - console errors and wrong calculations
   - float-based money math and missing validation
   - database access and security gaps (e.g. row-level security)
   - race conditions and slow or N+1 queries
4. Map each existing feature to the target modules in §9, marking it as keep, refactor, rebuild, or remove.
5. Inventory the existing data. Propose whether we migrate it or start fresh with opening balances.
6. Write everything to `docs/AUDIT.md`. For each issue, give the file, line, severity, and proposed fix.

⛔ **Checkpoint:** show me the audit summary.

### Phase 1 — Questions and feature menu

1. Ask me the questions in §15, plus anything the audit raised. Group them, keep each one short, and suggest a default answer for each.
2. Present the feature menu in §16. For each feature:
   - explain in 2–3 lines how it would work in *our* app;
   - let me choose **include / skip / include with changes**.

   Also suggest any QuickBooks feature I've missed that a construction company would benefit from.
3. Record my answers in `docs/DECISIONS.md`.

⛔ **Checkpoint:** wait for my answers before building anything.

### Phase 2 — Target architecture plan

Write out the following:

- the final schema: tables, columns, constraints, and indexes
- the migration plan from the current schema
- the module and folder structure
- the route map and navigation
- the posting rules for every transaction type
- the test plan

⛔ **Checkpoint:** wait for my approval.

### Phase 3 — Engines first (test-first)

Build these engines, with their tests (§13), before any UI:

- the posting engine and invariant checks
- the profit-split calculator
- the payroll calculator
- GST period totals
- project value calculations

All tests must pass before moving on.

### Phase 4 — Modules, in this order

1. Settings and Chart of Accounts
2. Contacts
3. Projects and Project Value
4. Sales
5. Expenses
6. Payroll
7. Banking
8. Taxes (GST)
9. Financing and Profit Share
10. Reports and Financial Statements
11. Dashboard

After each module:

1. Run the full test suite and fix any failures.
2. Commit.
3. Give me a 3-line summary.

### Phase 5 — Connectivity, QA, final report

1. Work through the connectivity checklist in §14.
2. Run all tests, the invariants, and the health check on real data.
3. Fix everything you find, then write `docs/QA_REPORT.md`. It should contain:
   - what was tested
   - what passed
   - what's still open
   - a 10-minute manual walkthrough script I can follow to verify the system myself

---

## 1. Accounting core rules

- **Double-entry.** Every source document (invoice, bill, payroll run, payment, etc.) generates journal lines when it is saved. Total debits must equal total credits per transaction. Enforce this in the database (a deferred constraint trigger or equivalent), not only in app code.
- **Post on save.** When a transaction is created or edited, delete and regenerate its journal lines atomically. When it is voided, zero it out and keep the record. Nothing is ever hard-deleted once posted.
- **Never store balances.** Account, customer, vendor, project, employee, and person balances are always derived from journal lines. Use views or materialized views if speed becomes an issue.
- **Control accounts plus sub-ledgers.** There is one Accounts Receivable account and one Accounts Payable account. Each journal line carries `contact_id`, `project_id`, and `employee_id` tags where relevant.
- **Payment applications.** Payments are linked to the invoices or bills they settle. Statuses (Draft, Sent, Partial, Paid, Overdue, Void) are derived from those links, never stored.
- **Accrual and cash basis.** Both come from the same data. Reports have a basis toggle.
- **Retained Earnings.** Computed at report time from prior fiscal years. There are no closing entries.
- **Two locks:**
  - **Closing date** (books): blocks creating, editing, or voiding anything dated on or before that date.
  - **Filed GST quarters:** see §8.
- **Audit log.** Every change records who made it, when, and the before/after values.

---

## 2. Chart of accounts (seed; I can edit it)

**Assets**
- Bank – MVR
- Bank – USD
- Cash
- Undeposited Funds
- Accounts Receivable
- Retention Receivable *(if enabled)*
- Contract Asset – Unbilled Revenue *(if percentage-of-completion is enabled, see §4)*
- GST Input Tax Receivable
- GST Refund / Carry-forward Receivable
- Staff Advances
- Prepayments
- Equipment
- Vehicles
- Accumulated Depreciation

**Liabilities**
- Accounts Payable
- Credit Card
- GST Output Tax Payable
- GST Payable – MIRA
- Salaries Payable
- Pension Payable
- Employee Withholding Tax Payable
- Other Payroll Deductions Payable
- Business Profit Tax Payable
- Customer Advances *(if enabled)*
- Retention Payable *(if enabled)*
- Contract Liability – Billings in Excess *(if percentage-of-completion is enabled)*
- Accrued Expenses
- Project Loans – [one sub-account per external lender]
- Capital Pool Loans, with sub-accounts: Mujahid, Muaz, Mushahid, Mariyam Zahir
- Financing Return Payable, with one sub-account per financing source
- Profit Share Payable, with sub-accounts: Mujahid, Muaz, Mushahid, Mariyam Zahir

**Equity**
- Share Capital
- Retained Earnings
- Dividends
- Opening Balance Equity

**Income**
- Contract Revenue
- Variation Revenue
- Other Income

**Job Costs (COGS)**
- Materials
- Subcontractors
- Direct Labour (from payroll)
- Equipment Hire
- Freight & Logistics
- Site Expenses
- Non-claimable GST

**Expenses**
- Admin Salaries
- Employer Pension Contribution
- Staff Allowances
- Work Permits & Visas
- Staff Insurance
- Staff Accommodation & Food
- Rent
- Utilities
- Professional Fees
- Bank Charges
- Depreciation
- Bad Debts
- FX Gain/Loss
- Finance Cost – Profit Participation
- Profit Share *(the debit account is configurable, see §5)*
- Income Tax Expense (BPT)

**Why these are sub-accounts:** each of the per-person accounts (Capital Pool Loans, Financing Return Payable, Profit Share Payable) covers only 4–5 people. Using sub-accounts means each person's balances show directly on the Balance Sheet.

---

## 3. Posting rules

| Transaction | Debit | Credit |
|---|---|---|
| Invoice / progress invoice | AR (client, project) | Contract Revenue + GST Output Tax Payable |
| Receive payment | Undeposited Funds or Bank | AR |
| Bank deposit | Bank | Undeposited Funds |
| Sales receipt | Bank / Undeposited Funds | Revenue + GST Output |
| Credit note | Revenue + GST Output | AR |
| Client advance *(if enabled)* | Bank | Customer Advances |
| Apply advance to invoice | Customer Advances | AR |
| Invoice with retention *(if enabled)* | AR (net) + Retention Receivable | Revenue + GST Output |
| Bill, GST claimable | Job Cost / Expense / Asset + GST Input Tax Receivable | AP |
| Bill, GST not claimable | Job Cost / Expense (including the GST) | AP |
| Pay bill | AP | Bank |
| Expense / cheque | Job Cost / Expense (+ GST Input if claimable) | Bank / Credit Card |
| Vendor credit | AP | Job Cost / Expense (+ GST Input) |
| Transfer | Bank B | Bank A |
| Manual journal entry | as entered (must balance) | as entered |
| Bad debt write-off | Bad Debts (project) | AR |
| External loan received | Bank | Project Loans – Lender (project) |
| Capital Pool contribution | Bank | Capital Pool Loan – Person (project) |
| Profit distribution (§5) | Finance Cost – Profit Participation + Profit Share | Financing Return Payable – each source + Profit Share Payable – each person |
| Payout | The specific liability (one line per component) | Bank |
| Payroll run (§7) | Direct Labour (per project) + Admin Salaries + Employer Pension | Salaries Payable + Pension Payable + Withholding Tax Payable + Staff Advances (recoveries) + Other Deductions |
| Salary payment | Salaries Payable | Bank |
| Pension / withholding-tax remittance | Pension Payable / WHT Payable | Bank |
| Staff advance | Staff Advances | Bank |
| GST quarter settlement (§8) | GST Output Tax Payable | GST Input Tax Receivable + GST Payable – MIRA (or Dr Carry-forward if input > output) |
| GST payment | GST Payable – MIRA | Bank |
| WIP adjustment *(POC only, §4)* | Contract Asset or Revenue | Revenue or Contract Liability |
| BPT provision | Income Tax Expense | Business Profit Tax Payable |
| FX revaluation | FX Gain/Loss or the balance | The balance or FX Gain/Loss |

Every line that relates to a project must carry `project_id`.

---

## 4. Customers, projects and project value

**Structure**
- Every project belongs to exactly one customer (client). A customer can have many projects.
- Flow: Estimate → contract → progress invoices by stage (%, amount, or line) → costs tagged to the project → payments applied → completion.
- On bills, expenses, and payroll allocations, every line has a **Customer/Project** field.

**Project value.** All of these are live and derived; none are stored as totals.

- **Contract value:**
  - original contract value
  - approved variations (numbered, each with a status: pending, approved, or rejected)
  - revised contract value
- **Budget:** estimated cost by category (materials, subcontractors, labour, equipment, freight, site), with a revised budget.
- **Billing:**
  - invoiced to date
  - % billed
  - remaining to bill
  - collected
  - client balance
  - retention held
- **Cost:**
  - costs to date by category, including labour from payroll
  - committed costs (open POs, if enabled)
  - estimated cost to complete (budget minus actual, editable as a forecast)
  - forecast final cost
- **Result:**
  - forecast profit and margin
  - % complete (cost-to-cost)
  - over/under billing (billed vs earned)

**Revenue recognition** is a setting; confirm the choice with the auditor.

- **Billing-based** (default): revenue is recognised when invoiced.
- **Percentage-of-completion:** at each period end, calculate earned revenue as % complete × revised contract value.
  - If earned > billed: Dr Contract Asset – Unbilled Revenue / Cr Contract Revenue.
  - If billed > earned: Dr Contract Revenue / Cr Contract Liability – Billings in Excess.
  - The adjustment auto-reverses at the start of the next period.

**The profit split (§5)** always uses the project's *final actual* profit at completion, never the forecast.

---

## 5. Financing and profit-share model

**Profit-share scheme.** Schemes are versioned with an effective date, and their percentages must total 100% (validate this). The current scheme is:

| Party | Share |
|---|---|
| Investors (financing pool) | 20% |
| Company (retained) | 30% |
| Mujahid (MD) | 25% |
| Muaz | 10% |
| Mushahid | 10% |
| Mariyam Zahir | 5% |

**Financing.** Each project records its financing sources: external lenders and/or Capital Pool members (Mujahid, Muaz, Mushahid, Mariyam Zahir). The contribution ratio is each source's amount divided by total project financing.

**Split logic:**

- **Financing pool:** 20% of project profit, divided among financing sources by contribution ratio.
- **Fixed shares** (25 / 10 / 10 / 5): apply to project profit whether or not that person financed the project.
- **Company 30%:** not posted anywhere. It simply stays as profit.
- **Payout components.** A Capital Pool member's total payout from a project has three parts:
  1. principal back
  2. their share of the financing pool
  3. their fixed profit share

  These are **three separate amounts** in three separate accounts. They are never merged, and statements always show them separately.
- **Rounding:** calculate in laari. Any remainder goes to the Company line.
- **Accounting treatment (pending auditor):**
  - Capital Pool contributions are liabilities (shareholder loans).
  - The debit account for fixed profit shares must be a setting: either the Profit Share expense account or Dividends (equity).

### Worked example (use as a test fixture)

The project profit is MVR 500,000. Financing was MVR 1,000,000 in total:

- External lender: 400,000 (40%)
- Mujahid: 300,000 (30%)
- Muaz: 200,000 (20%)
- Mushahid: 100,000 (10%)

Expected results:

| Party | Principal | 20% pool | Profit share | Total |
|---|---|---|---|---|
| External lender | 400,000 | 40,000 | – | 440,000 |
| Mujahid | 300,000 | 30,000 | 125,000 | 455,000 |
| Muaz | 200,000 | 20,000 | 50,000 | 270,000 |
| Mushahid | 100,000 | 10,000 | 50,000 | 160,000 |
| Mariyam Zahir | – | – | 25,000 | 25,000 |
| Company keeps | | | 150,000 | |

The distribution journal entry is:

- Dr Finance Cost 100,000
- Dr Profit Share 250,000
- Cr the payables as listed in the table above

Total debits and credits are both 350,000.

---

## 6. Payout and bad-debt rules

**Project status flow:** Active → Completed → Settled → Closed.

- **Completed**
  1. Compute final project profit, using the definition in `DECISIONS.md`.
  2. Show a split preview for me to confirm.
  3. Post the distribution journal.
- **Payouts blocked until settled.** Payouts are blocked, in both the UI and the server, until the project's client balance is exactly 0, meaning every invoice is paid or written off. The UI must show *why* a payout is blocked and how much the client still owes.
- **Settled.** Set automatically when the client balance reaches 0. Payouts are enabled from this point.
- **Principal repayments** follow the same release rule, unless `DECISIONS.md` says otherwise.
- **Bad debt.** A write-off (Dr Bad Debts tagged to the project, Cr AR) reduces project profit.
  - If the distribution is already posted, the system recalculates the split and posts an **adjustment journal** for the difference. It never edits the original entry.
  - Every share shrinks proportionally.
- **Late entries.** If revenue or costs (including payroll) hit a project after Completed, the same auto-adjustment runs, and the project is flagged for my review.
- **Closed.** Set when every project-related payable and loan is fully paid.

---

## 7. Payroll

### Employees

Each employee record holds:

- name
- type (Maldivian or expatriate)
- role and department (site or admin)
- basic salary and fixed allowances
- salary bank details
- pension eligibility
- start and end dates
- work-permit expiry (expatriates), with a reminder

### Pay items

Pay items are configurable. Each maps to an account and is flagged as taxable and/or pensionable.

- **Earnings:** basic, allowances (e.g. island/site, living, transport, phone), overtime, bonus.
- **Deductions:** employee pension, employee withholding tax, no-pay/absence, salary-advance recovery, other.
- **Employer contributions:** employer pension.
- **Rates:** pension % and withholding-tax brackets come from settings, each with an effective date.

### Monthly payroll run

**Status flow:** Draft → Review → Approved → Posted → Paid.

1. Pre-fill each employee from their defaults.
2. Add overtime, attendance/no-pay, one-off items, and advance recoveries.
3. Calculate gross, deductions, employer contributions, and net pay.
4. On approval, generate:
   - payslips as PDF
   - a bank transfer file (CSV in the bank's format)
   - a payroll summary

### Labour cost to projects

- Site staff cost (gross plus employer contributions) is allocated to projects by timesheet days/hours or by fixed % (per `DECISIONS.md`). Each employee's allocation must total 100%.
- Admin staff cost goes to overhead (Admin Salaries).
- Direct Labour is posted with `project_id`, so it flows into the project P&L, project value, and the profit split automatically.
- Expatriate costs (permits, visas, insurance, accommodation, food) are recorded as expenses and can be allocated to projects the same way.

### Posting on approval

- **Debits:**
  - Direct Labour (per project)
  - Admin Salaries
  - Employer Pension Contribution
- **Credits:**
  - Salaries Payable (net)
  - Pension Payable (employee + employer)
  - Employee Withholding Tax Payable
  - Staff Advances (recoveries)
  - Other Deductions Payable

Then:

- Salary payment clears Salaries Payable.
- Pension and withholding-tax remittances clear their payables.

### Access

Only roles with payroll permission can see payroll data. Enforce this in both the UI and the database.

---

## 8. GST — quarterly input and output tax

### Setup

- GST filing period: **quarterly**. Period length is a setting, so it can change to monthly later.
- Tax codes are configurable, each with an effective-dated rate: standard, zero-rated, exempt, out of scope.

### Output tax

Every invoice, sales receipt, and credit note posts GST to **GST Output Tax Payable**.

### Input tax

Bills and expenses post GST to **GST Input Tax Receivable** only when all of these hold:

- the supplier is GST-registered;
- a valid tax invoice is captured: supplier TIN, tax invoice number, and date;
- the line is marked claimable.

If any of these is missing, the GST amount goes into the cost (the Non-claimable GST or cost account). The UI must refuse to mark input tax claimable without a TIN and tax invoice number.

GST paid at customs on imported materials is also input tax. Capture the customs declaration reference as its evidence (per `DECISIONS.md`).

### Quarter-end workflow

1. **Return worksheet** for the quarter:
   - total output tax
   - total input tax
   - net payable, or credit
2. **Schedules** (export to Excel/CSV):
   - output tax schedule, per invoice
   - input tax schedule, per supplier tax invoice, with TIN
3. **Review, then File.** Filing marks the quarter as filed and locks it for tax. Any transaction dated in a filed quarter is either blocked or flagged for adjustment in the next return (per `DECISIONS.md`).
4. **Settlement journal:**
   - Dr GST Output Tax Payable (the quarter's total)
   - Cr GST Input Tax Receivable (the quarter's total)
   - Cr GST Payable – MIRA (the net)
   - If input exceeds output: Dr GST Refund/Carry-forward Receivable instead.
5. **Payment:** Dr GST Payable – MIRA / Cr Bank. Status moves to Paid.

### Dashboard

- the current quarter's GST position to date
- the next filing and payment due date (the due day is a setting)
- any filed-but-unpaid quarter

---

## 9. Modules (QuickBooks parity)

**Dashboard**
- cash by bank account
- AR and AP totals, with overdue amounts
- P&L for the current period
- active projects with value, billed, and forecast profit
- payouts pending or blocked
- next payroll
- current-quarter GST and its due date
- accounts due for reconciliation

**Sales**
- **Customers:** list with open and overdue balances. Detail page with tabs for Transactions, Projects, and Statement.
- **Estimates:** convert to a contract, an invoice, or progress invoices.
- **Invoices:** money bar at the top showing Unpaid, Overdue, and Paid (last 30 days). Derived statuses. PDF tax invoice.
- **Receive payment:** applies to multiple invoices and handles partial payments.
- **Sales receipts, credit notes, and deposits** (moving Undeposited Funds to Bank).
- **Customer statements** as PDF.

**Expenses**
- vendors, with TIN and GST-registered flag
- bills, with tax invoice capture, and pay bills in batches
- expenses and cheques
- vendor credits

**Projects**
- **List view:** status, revised contract value, billed %, collected, cost, forecast profit, margin, client balance.
- **Detail tabs:**
  - Overview
  - Value & Budget
  - Variations
  - Transactions
  - Labour
  - Financing
  - Profit Split
  - Payouts
  - Documents

**Payroll & Staff**
- employees
- pay items
- payroll runs
- payslips
- staff advances
- labour allocation
- pension and withholding-tax remittances

**Taxes**
- GST quarters: worksheet, schedules, file & lock, settlement, payment
- payroll tax remittances
- BPT provision

**Partners & Financing**
- Capital Pool members and external lenders.
- **Per-person statement,** broken down by project, showing principal, financing returns, and profit share. Each component shows accrued, paid, and outstanding amounts.
- **Payouts screen** with the release rules from §6 enforced.

**Banking**
- account registers
- transfers
- CSV statement import, with match-or-add for each line
- reconciliation:
  1. Enter the statement's ending balance.
  2. Tick cleared lines.
  3. The difference must reach 0 before the reconciliation can be finished.
  4. A reconciliation report is produced, and the last reconciliation can be undone.

**Accounting**
- Chart of Accounts with balances and drill-down
- manual journal entries
- closing-date lock
- audit log

**Settings**
- company info, logo, and TIN
- fiscal year
- currencies and exchange rates
- tax codes and rates
- payroll rates
- document numbering
- invoice template
- profit-share schemes
- users and roles

**Global**
- "+ New" button with a grouped menu: Customers, Vendors, Employees, Projects & Financing, Other
- global search by number, name, or amount
- attachments on every transaction
- CSV and PDF export on every list and report

---

## 10. UI — similar to QuickBooks Online

Copy the layout and workflow of QuickBooks Online. **Do not** use the Intuit or QuickBooks name, logo, or assets; use Spruce & Co branding.

**Layout**
- Left sidebar: Dashboard, Sales, Expenses, Projects, Payroll, Partners & Financing, Banking, Taxes, Reports, Accounting, Settings.
- Top bar: global search, "+ New", and a settings gear.

**List pages**
- summary bar at the top
- filters and status badges
- bulk actions
- a row action menu: Receive payment, Print, Send, Duplicate, Void

**Transaction forms**
- **Header:** customer or vendor, project, dates, terms, and number.
- **Line grid:** item or account, description, qty, rate, amount, tax code, and project.
- **Running totals,** with GST shown separately.
- **Memo and attachments.**
- **Footer buttons:** Save, Save & new, Save & close, and a More menu with Void, Duplicate, and Audit history.

**General**
- Every page has loading, empty, and error states.
- Void and delete actions require a confirm dialog.
- Forms are keyboard-friendly.
- The layout works on mobile widths.

---

## 11. Reports and financial statements

**Every report has:**
- date-range presets and comparison columns (prior period, prior year)
- filters (project, customer, vendor, employee, account)
- accrual/cash toggle where relevant
- drill-down on every figure, to transactions and then to the source document
- PDF and Excel export
- the option to save customised versions

### Financial statements

- **Statement of Profit or Loss:** by month, quarter, or year; columns by project; % of revenue; comparatives.
- **Statement of Financial Position** (Balance Sheet): as at a date, with comparatives.
- **Statement of Cash Flows:** indirect method, with a direct cash summary.
- **Statement of Changes in Equity:** share capital, retained earnings, profit for the period, dividends.
- **Trial Balance:** opening, movement, and closing.
- **Supporting schedules for the notes:**
  - receivables aging
  - payables
  - loans (external and Capital Pool)
  - related-party balances (shareholders/directors: loans, payables, payouts)
  - payroll costs
  - GST
  - BPT
  - fixed assets *(if enabled)*
- **Year-end pack:** all of the above in one PDF and Excel file for the auditor.

### Project reports

- **Project Value Summary** (all projects):
  - contract, variations, revised value
  - billed, collected, cost
  - forecast profit, margin, % complete
- **Project detail P&L**
- **Budget vs Actual** by cost category
- **WIP / Over-Under Billing**
- **Cost by category**
- **Labour cost by project**
- **Retention schedule** *(if enabled)*
- **Variations register**

### Sales and receivables

- AR Aging (summary and detail)
- Customer Balance
- Open Invoices
- Collections
- Sales by customer/project

### Expenses and payables

- AP Aging
- Vendor Balance
- Unpaid Bills
- Expenses by category/vendor/project

### Payroll

- Payroll Summary by month
- Payslips
- Payroll by Employee (annual)
- Payroll by Project
- Pension schedule
- Withholding-tax schedule
- Staff advances

### Tax

- GST Return worksheet by quarter
- Output and input tax schedules
- GST control reconciliation
- Filing history

### Partners and financing

- Partner Statement (per person)
- Financing Summary
- Payouts Pending/Blocked
- Distribution history

### Banking and control

- Reconciliation reports
- Cash Position
- General Ledger
- Journal
- Audit Log
- Health Check

---

## 12. Target data model (adapt to the stack)

```
accounts            (id, name, type, subtype, parent_id, currency, is_system, active)
contacts            (id, kind[customer|vendor|lender|partner], name, tin, gst_registered, details…)
employees           (id, name, type[maldivian|expatriate], role, department[site|admin], basic_salary, bank_details, pension_eligible, start_date, end_date, permit_expiry)
projects            (id, customer_id, name, status, original_contract_value, scheme_id, recognition_method, start_date, completed_at, settled_at, closed_at)
variations          (id, project_id, number, description, amount, status[pending|approved|rejected], approved_at)
project_budgets     (id, project_id, category, budget_amount, revised_amount, forecast_to_complete)
items               (id, name, type, income_account_id, expense_account_id, asset_account_id, tax_code_id)
transactions        (id, type, number, date, due_date, contact_id, project_id, currency, fx_rate, status, memo,
                     supplier_tin, tax_invoice_no, customs_ref, gst_claimable, tax_period_id, voided_at, created_by)
transaction_lines   (id, transaction_id, item_id, account_id, description, qty, rate, amount, tax_code_id, tax_amount, project_id)
journal_lines       (id, transaction_id, account_id, debit, credit, home_debit, home_credit, contact_id, project_id, employee_id, cleared_status)
applications        (id, from_transaction_id, to_transaction_id, amount)
pay_items           (id, name, kind[earning|deduction|employer_contribution], calc[fixed|percent|bracket], account_id, taxable, pensionable)
payroll_runs        (id, period, status, journal_transaction_id)
payslips            (id, run_id, employee_id, gross, deductions, employer_contributions, net)
payslip_lines       (id, payslip_id, pay_item_id, amount)
labour_allocations  (id, payslip_id, project_id, basis[hours|days|percent], quantity, amount)
rates               (id, kind[gst|pension|wht], code, value_or_brackets_json, effective_from)
tax_periods         (id, tax[gst], start_date, end_date, status[open|filed|paid], output_total, input_total, net,
                     filed_at, settlement_transaction_id, payment_transaction_id)
wip_adjustments     (id, project_id, period_end, earned, billed, journal_transaction_id, reversal_transaction_id)
project_financing   (id, project_id, source_contact_id, source_type[external|capital_pool], amount, date, loan_account_id)
profit_schemes      (id, name, effective_from)
scheme_allocations  (id, scheme_id, party_contact_id|party_type, percent, payable_account_id)
distributions       (id, project_id, scheme_id, profit_amount, status, journal_transaction_id, adjusts_distribution_id)
distribution_lines  (id, distribution_id, contact_id, component[principal|financing_return|profit_share], amount)
bank_imports / bank_statement_lines / reconciliations
currencies, exchange_rates, attachments, audit_log, settings(closing_date, fiscal_year_start, gst_period, gst_due_day, …), users/roles
```

---

## 13. Testing requirements

### Unit tests

- **Posting rules:** every rule in §3 produces the exact expected lines, and they balance.
- **Split calculator.** Cover all of these cases:
  - the §5 worked example (exact match)
  - zero profit
  - a loss (behaviour per `DECISIONS.md`)
  - a single financier
  - external-only financing
  - no financing
  - a rounding remainder
  - a partner with no contribution
- **Payroll:**
  - gross-to-net with pension and withholding-tax brackets (from settings fixtures)
  - no-pay deductions and advance recovery
  - allocations must total 100%
  - payment and remittances clear their payables
- **GST:**
  - quarter totals are correct
  - non-claimable input tax goes to cost
  - input tax cannot be claimed without a TIN and tax invoice number
  - filing locks the quarter
  - the settlement journal zeroes the quarter's input and output
  - carry-forward works when input exceeds output
- **Project value:**
  - variations update the revised contract value
  - % complete is correct
  - over/under billing is correct
  - POC WIP entries post and auto-reverse
- **Payout block and bad-debt adjustment:** payouts are refused while the client balance is above 0, and a write-off produces the correct adjustment journal.
- **Derived values:**
  - status derivation
  - aging buckets
  - FX conversion
  - closing-date lock

### Invariants

These run after every test scenario, and also as an admin **Health Check** page or command that works on real data:

1. Every transaction balances (Σ debit = Σ credit).
2. The trial balance nets to 0.
3. The Balance Sheet balances: Assets = Liabilities + Equity + current-year profit.
4. The AR account balance equals the sum of all customer balances. The same holds for AP and vendor balances.
5. Every invoice and bill status matches its applied payments.
6. Each project's P&L equals the sum of its project-tagged lines, and project value figures tie to the ledger.
7. For each person, their payable balances equal posted distributions minus payouts.
8. Payroll payables (salaries, pension, WHT) equal posted runs minus payments and remittances.
9. The GST accounts equal the unfiled quarters' totals plus filed-but-unpaid quarters.
10. The Cash Flow statement's net change equals the change in cash and bank accounts.
11. Statement of Changes in Equity closing balances equal Balance Sheet equity. P&L net profit equals the profit line in the Statement of Changes in Equity.
12. No orphans in either direction: no journal line without a source transaction, and no posted transaction without journal lines.
13. Nothing in a closed period or filed GST quarter was changed without an adjustment.

### Property test

Generate random valid transaction sequences, including payroll runs and GST quarters, and confirm that all invariants still hold.

### End-to-end (browser) tests

**Full project lifecycle:**

1. Create a client and a project with a budget.
2. Add a variation.
3. Create progress invoices (with GST).
4. Enter bills with claimable and non-claimable GST.
5. Run payroll with site labour allocated to the project.
6. Record a Capital Pool contribution and an external loan.
7. Record a partial client payment.
8. Mark the project Completed. Confirm payouts are **blocked**.
9. Record the final client payment. Confirm payouts are **released**.
10. Pay out all three components.
11. Confirm every report and financial statement ties out.

**GST quarter:**

1. Enter invoices and bills.
2. File the return.
3. Post the settlement.
4. Pay MIRA.
5. Confirm the quarter is locked.

**Bad-debt path:** repeat the lifecycle, but write off the final invoice instead of collecting it. Confirm the split adjusts and payouts are released.

### Build checks

Build, type-check, and lint must all pass with zero errors. There must be no console errors on any page.

---

## 14. Connectivity checklist (Phase 5)

- Every "+ New" item opens a working form.
- Every form saves, posts journal lines, and then appears in its register, its list, and the relevant reports and financial statements.
- Every report number drills down to its source document, and you can navigate back.
- These chains link both ways:
  - Customer ↔ Projects ↔ Estimates ↔ Invoices ↔ Payments ↔ Deposits ↔ Bank
  - Vendor ↔ Bills ↔ Bill payments ↔ Bank
  - Employee ↔ Payslips ↔ Payroll run ↔ Labour allocation ↔ Project ↔ Salary payment ↔ Bank
  - Invoices and bills ↔ GST quarter ↔ Return ↔ Settlement ↔ MIRA payment
  - Project ↔ Value & Budget ↔ Financing ↔ Distribution ↔ Payables ↔ Payouts ↔ Partner statements
- Editing or voiding a source document updates everything downstream, including project value, profit, the split adjustment, the GST quarter (if still open), and the financial statements.
- There are no dead routes, dead buttons, or placeholder pages.
- Permissions are enforced the same way in the UI and in the database (payroll especially).

---

## 15. Open questions (ask me in Phase 1)

**Profit and financing**
1. Is project profit based on direct costs only, or does it include an overhead allocation? If overhead, which method?
2. If a project makes a loss, who bears it? Is principal at risk? Do fixed shares become zero, or negative?
3. Is principal repaid under the same release rule as payouts, or earlier?
4. Is the contribution ratio based on amount only, or amount × time?
5. Do external lenders get only their share of the 20% pool, or interest as well?
6. Which scheme applies to a project: the one active at project start, or at completion? Are there past projects under the old "Investor Split" model, and how did that model work?
7. Should the fixed profit shares be posted as an expense or as dividends? (I'm awaiting the auditor; build it as a setting.)

**Payroll**
8. What is the pay cycle and pay day?
9. How many staff are Maldivian vs expatriate, and on site vs in admin?
10. What are the pension rates, and which staff do they apply to?
11. Do we withhold income tax from salaries? Which brackets apply?
12. Which allowances do we pay? What are the overtime rules?
13. How is site labour allocated to projects: timesheets, or fixed %?
14. Do we give salary advances? How are they recovered?
15. Are directors paid through payroll?
16. Should expatriate costs (permits, insurance, accommodation, food) be allocated to projects?
17. Who can see payroll data?

**GST**
18. Which GST rate(s) and tax codes apply to our sales and purchases?
19. Please confirm the quarterly filing, plus the filing and payment due day.
20. If input tax exceeds output tax, do we carry it forward or claim a refund?
21. A bill arrives dated in an already-filed quarter: block it, or adjust it in the next return?
22. Do we import materials and pay GST at customs? How do we evidence the input claim?

**Billing**
23. Do clients withhold retention? If so, what percentage and what release terms? Do we withhold retention from subcontractors?
24. Do clients pay mobilisation advances?
25. Which currencies do we use besides MVR?

**Financial statements**
26. Which framework do we report under: IFRS, or IFRS for SMEs?
27. Should revenue be recognised on a billing basis, or by percentage-of-completion?
28. Should the BPT provision be calculated, or entered manually? What fiscal year and which comparatives do we need?

**Setup and access**
29. Who uses the system, and with which roles? Should partners and investors log in to see their own statements?
30. Which banks do we use, and what are their statement export formats?
31. Should we migrate existing data, or start fresh with opening balances as at a chosen date?
32. What is the document numbering format and the invoice design?

---

## 16. Optional features (present as a menu in Phase 1)

For each feature, explain how it would work in our app and mark whether you recommend it.

- purchase orders (feeding committed costs in project value)
- materials inventory / stock on site
- fixed asset register and automatic depreciation
- timesheets for labour allocation
- employee self-service (payslips)
- recurring transactions
- email invoices and payment reminders
- bank rules and auto-matching
- multicurrency revaluation
- receipt scanning
- approval workflows (e.g. bills above a set amount, or payroll runs, need MD approval)
- client portal
- partner/investor portal
- import from QuickBooks or Excel

---

## Definition of done

- Every phase is complete and approved.
- All unit, invariant, property, and end-to-end tests pass.
- The Health Check passes on real data.
- Every financial statement ties to the ledger.
- Every audit issue is fixed, or listed as open along with its reason.
- `docs/QA_REPORT.md` is written, including the 10-minute manual walkthrough script.
