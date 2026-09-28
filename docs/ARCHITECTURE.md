# Phase 2 — Target architecture

Status: **draft for your approval** (⛔ Phase 2 checkpoint). It is built on `ACCOUNTING_SPEC.md`, `AUDIT.md` and `DECISIONS.md` (all defaults accepted, 28 Sep 2026). Section 9 lists four points that need your answer before Phase 3.

---

## 1. Principles

1. **One stored ledger.**
   - Every source document is a row in `transactions`, and what the user typed is kept in `transaction_lines`.
   - The ledger is `journal_lines`, generated from those by the database and never typed by hand.
   - Balances and statuses are always *derived* from journal lines and payment applications.
2. **The database is the accountant.**
   - Posting, the split calculator, payroll maths, GST totals and project value are **Postgres functions** (plpgsql/SQL), per decision A4.
   - The Next.js server only validates input (zod), calls one RPC per action, and formats results. The browser never computes money.
3. **Every write is one transaction.**
   - Each "save" is a single RPC: header, lines, journal and applications, committed together or not at all.
   - A deferred constraint trigger refuses any commit where a transaction's debits ≠ credits.
4. **Nothing posted is deleted.**
   - Void keeps the document, sets `voided_at` and removes its journal effect.
   - Edits regenerate the journal lines atomically.
   - Locked periods refuse both.
5. **Money:**
   - `numeric(18,2)` in the database; rates are `numeric(9,4)`.
   - In TypeScript, amounts cross the wire as strings and are handled as integer laari (`bigint`-safe helper) when anything is compared.
   - Floats are never used.
6. **Rates are data.** GST, pension, withholding tax and BPT come from `rates`, with an `effective_from` date.
7. **Non-destructive build** (A5).
   - New tables are built beside the old ones.
   - The old screens keep working on production until cut-over.
   - Old tables are then made read-only, and dropped only with your OK (A9).

---

## 2. Schema

Conventions for every table:
- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz default now()`, plus `created_by uuid default auth.uid()` where a person creates it
- RLS enabled
- the audit trigger `log_change()`
- money is `numeric(18,2)`

### 2.1 Settings and reference

| Table | Columns | Constraints and indexes |
|---|---|---|
| `settings` (single row) | `closing_date date`, `fiscal_year_start_month int` (default 1), `gst_registered bool`, `gst_period_months int` (default 3), `gst_due_day int` (default 28), `recognition_default text` (`billing`/`poc`, default `billing`), `profit_share_debit text` (`expense`/`dividends`, default `expense`), `approval_limit_bill numeric(18,2)`, `home_currency char(3)` (default `MVR`), `opening_balance_date date` | `id boolean pk check (id)` |
| `currencies` | `code char(3) pk`, `name`, `active` | seed MVR, USD |
| `exchange_rates` | `currency`, `rate_date date`, `rate numeric(18,6)` (MVR per unit) | pk (`currency`, `rate_date`) |
| `rates` | `kind` (`gst`/`pension_employee`/`pension_employer`/`wht`/`bpt`), `code text`, `value numeric(9,4)`, `brackets jsonb` (for `wht`/`bpt`: `[{from, to, rate}]`), `effective_from date` | unique (`kind`, `code`, `effective_from`) |
| `tax_codes` | `code` (`STD`, `ZERO`, `EXEMPT`, `OOS`), `name`, `rate_code` → `rates.code`, `active` | unique `code` |
| `document_sequences` | `type txn_type pk`, `prefix text` (e.g. `SC-INV/{YY}/`), `next_number int`, `pad int` | numbers taken with `update … returning` in the posting RPC (no race) |
| `profiles` (existing) | adds `can_payroll bool` (S1) | |

### 2.2 Chart of accounts

| Table | Columns | Constraints |
|---|---|---|
| `accounts` | `code text`, `name`, `type` enum (`asset`/`liability`/`equity`/`income`/`cogs`/`expense`), `subtype text`, `parent_id`, `contact_id` (per-person sub-accounts), `currency char(3)`, `is_system bool`, `active`, `description` | unique `code`; unique `subtype` where the subtype is a control account (`ar`, `ap`, `undeposited`, `gst_output`, `gst_input`, `gst_payable`, `gst_refund`, `salaries_payable`, `pension_payable`, `wht_payable`, `opening_equity`, `retained_earnings`…); a parent must have the same type; system accounts cannot be deleted or change type |

Seed (codes are editable later):

| Code | Accounts |
|---|---|
| **1000 Assets** | 1010 Bank – MVR · 1020 Bank – USD · 1030 Cash · 1040 Undeposited Funds · 1100 Accounts Receivable · 1110 Retention Receivable · 1120 Contract Asset – Unbilled Revenue · 1200 GST Input Tax Receivable · 1210 GST Refund / Carry-forward Receivable · 1300 Staff Advances · 1310 Prepayments · 1500 Equipment · 1510 Vehicles · 1590 Accumulated Depreciation |
| **2000 Liabilities** | 2000 Accounts Payable · 2010 Credit Card · 2100 GST Output Tax Payable · 2110 GST Payable – MIRA · 2200 Salaries Payable · 2210 Pension Payable · 2220 Employee Withholding Tax Payable · 2230 Other Payroll Deductions Payable · 2300 Business Profit Tax Payable · 2400 Customer Advances · 2410 Retention Payable · 2420 Contract Liability – Billings in Excess · 2500 Accrued Expenses · 2600 Project Loans (one sub-account per lender) · 2700 Capital Pool Loans (subs: Mujahid, Muaz, Mushahid, Mariyam Zahir) · 2800 Financing Return Payable (one sub per source) · 2900 Profit Share Payable (subs: Mujahid, Muaz, Mushahid, Mariyam Zahir) |
| **3000 Equity** | 3000 Share Capital · 3100 Retained Earnings · 3200 Dividends · 3900 Opening Balance Equity |
| **4000 Income** | 4000 Contract Revenue · 4010 Variation Revenue · 4900 Other Income |
| **5000 Job costs** | 5000 Materials · 5010 Subcontractors · 5020 Direct Labour · 5030 Equipment Hire · 5040 Freight & Logistics · 5050 Site Expenses · 5060 Non-claimable GST |
| **6000 Expenses** | 6000 Admin Salaries · 6010 Employer Pension Contribution · 6020 Staff Allowances · 6030 Work Permits & Visas · 6040 Staff Insurance · 6050 Staff Accommodation & Food · 6100 Rent · 6110 Utilities · 6120 Professional Fees · 6130 Bank Charges · 6200 Depreciation · 6210 Bad Debts · 6220 FX Gain/Loss · 6300 Finance Cost – Profit Participation · 6310 Profit Share · 6400 Income Tax Expense (BPT) |

The 15 existing `cost_categories` each map to one of 5000–5060 or 6xxx. Budget categories are fixed to the six job-cost categories in §4.

### 2.3 Contacts and employees

| Table | Columns | Notes |
|---|---|---|
| `contacts` | `kinds text[]` ⊆ {customer, vendor, lender, partner}, `name`, `company_name`, `contact_person`, `email`, `phone`, `address`, `tin`, `gst_registered bool`, `taxable_activity_no`, `bank_details`, `terms_days int`, `currency`, `vendor_kind`, `trade`, `licence_expiry`, `insurance_expiry`, `notes`, `active`, `legacy jsonb` (old ids) | GIN index on `kinds`; trigram index on `name` (vendor fuzzy match kept) |
| `employees` | `contact_id` (optional; a partner who is also staff), `name`, `nationality_type` (`maldivian`/`expatriate`), `job_title`, `department` (`site`/`admin`), `basic_salary`, `pension_eligible bool`, `wht_applicable bool`, `bank_name`, `bank_account`, `start_date`, `end_date`, `permit_no`, `permit_expiry`, `passport_no`, `active`, `legacy_person_id` | check `end_date ≥ start_date`; the permit-expiry reminder comes from a view |
| `employee_pay_items` | `employee_id`, `pay_item_id`, `amount` | the default allowances and deductions used to pre-fill runs |
| `employee_allocations` | `employee_id`, `project_id` (null = overhead), `percent numeric(7,4)`, `effective_from date` | deferred check: one employee's allocations on the same date total 100 |

### 2.4 Projects (the existing table, refactored)

| Table | Change |
|---|---|
| `projects` | **adds:** `customer_id` → `contacts`, `scheme_id` → `profit_schemes` (set at start, P6), `recognition_method` (default from settings), `archived_at` (done), `review_flag text` (late-entry flag). **Kept:** `code`, `name`, `contract_value` (= original contract value), `start_date`, `completed_at`. Old money columns (`gst_amount`, `payment_received_*`, `financing_repay_pct`) stop being used after cut-over |
| `variations` | **adds:** `number int` (unique per project) and `amount` (= `cost_impact`). Status maps: draft/submitted → pending, approved, rejected/cancelled → rejected |
| `budget_lines` | **adds:** `budget_category` (materials/subcontractors/labour/equipment/freight/site), `revised_amount`, `forecast_to_complete` |
| `billing_stages` (new) | `project_id`, `name`, `basis` (`percent`/`amount`), `value`, `due_event text`, `invoice_id` | the progress-billing feature |

**Project stage is derived, never stored** (view `project_stage_v`):
- **Active:** `completed_at` is null.
- **Completed:** completed, and the client balance is above 0.
- **Settled:** completed, the client balance is 0, and project payables or loans are still open.
- **Closed:** settled, and every project payable and loan balance is 0.

### 2.5 Transactions and the ledger

**`txn_type` enum**
- Sales: `estimate` (non-posting), `invoice`, `credit_note`, `sales_receipt`, `customer_payment`, `deposit`, `customer_advance`, `advance_application`
- Purchases: `purchase_order` (non-posting), `bill`, `vendor_credit`, `bill_payment`, `expense`
- Banking and journals: `transfer`, `journal`, `opening_balance`
- Payroll: `payroll_run`, `salary_payment`, `payroll_remittance`, `staff_advance`
- Financing: `loan_receipt`, `capital_contribution`, `distribution`, `payout`
- Tax: `gst_settlement`, `gst_payment`, `bpt_provision`
- Adjustments: `bad_debt`, `wip_adjustment`, `fx_revaluation`, `depreciation`

| Table | Columns | Constraints and indexes |
|---|---|---|
| `transactions` | `type`, `number`, `date`, `due_date`, `contact_id`, `project_id` (header default), `bank_account_id`, `currency`, `fx_rate numeric(18,6)` (default 1), `memo`, `reference`, `terms_days`; GST evidence `supplier_tin`, `tax_invoice_no`, `tax_invoice_date`, `customs_ref`; flow `is_draft bool`, `sent_at`, `approval_status` (`not_required`/`pending`/`approved`), `approved_by`, `approved_at`; links `payroll_run_id`, `tax_period_id`, `distribution_id`, `reverses_id`, `adjusts_id`, `recurring_id`; `voided_at`, `void_reason`, `updated_at` | unique (`type`, `number`) where `number` is not null; index (`type`, `date`), (`contact_id`), (`project_id`) |
| `transaction_lines` | `transaction_id`, `line_no`, `item_id`, `account_id`, `description`, `qty numeric(18,4)`, `rate numeric(18,4)`, `amount`, `tax_code_id`, `tax_amount`, `gst_claimable bool`, `project_id`, `employee_id`, `contact_id`, `budget_category`, `po_line_id`, `debit`, `credit` (journal and opening-balance types only) | `amount = round(qty*rate,2)` when qty/rate are given; `debit`/`credit` ≥ 0, never both |
| `journal_lines` | `transaction_id`, `line_no`, `date` (copied from the header), `account_id`, `debit`, `credit`, `currency`, `fx_rate`, `home_debit`, `home_credit` (MVR), `contact_id`, `project_id`, `employee_id`, `tax_period_id`, `component` (`principal`/`financing_return`/`profit_share`, for distributions and payouts), `cleared` (`uncleared`/`cleared`/`reconciled`), `reconciliation_id`, `memo` | `check (debit >= 0 and credit >= 0 and (debit = 0 or credit = 0))`; **deferred constraint trigger: Σ home_debit = Σ home_credit per transaction**; index (`account_id`, `date`), (`project_id`, `account_id`), (`contact_id`, `account_id`), (`employee_id`), (`tax_period_id`), (`transaction_id`) |
| `applications` | `from_transaction_id` (payment, credit note, vendor credit, advance application, bad debt, bill payment), `to_transaction_id` (invoice or bill), `amount > 0` | trigger: same contact; total applied to a document ≤ its open total; total applied from a payment ≤ its amount; neither side voided |
| `items` | `name`, `type` (`service`/`product`/`other`), `income_account_id`, `expense_account_id`, `tax_code_id`, `default_rate`, `active` | |
| `attachments` | `transaction_id` (or `entity`+`entity_id`), `storage_path`, `file_name`, `mime`, `size` | files stay in the existing private buckets |

**Derived document status** (view `document_status_v`), checked in this order:
1. **Void:** `voided_at` is set.
2. **Draft:** `is_draft`.
3. **Paid:** applied ≥ total.
4. **Overdue:** balance > 0 and `due_date` < today (Maldives time).
5. **Partial:** 0 < applied < total.
6. **Sent:** `sent_at` is set.
7. **Open:** anything else.

### 2.6 Payroll

| Table | Columns | Notes |
|---|---|---|
| `pay_items` | `name`, `kind` (`earning`/`deduction`/`employer_contribution`), `calc` (`fixed`/`percent`/`bracket`/`hours`/`days`), `rate_kind` → `rates.kind`, `account_id`, `taxable`, `pensionable`, `is_advance_recovery bool`, `active` | seed: Basic, Island/Site, Living, Transport, Phone, Overtime, Bonus, No-pay, Employee Pension, Employee WHT, Advance Recovery, Other Deduction, Employer Pension |
| `payroll_runs` | `period_month date`, `pay_date`, `status` (`draft`/`review`/`approved`/`posted`), `journal_transaction_id`, `approved_by`, `approved_at`, `notes` | unique `period_month`; **Paid is derived** when Salaries Payable for the run is 0 |
| `payslips` | `run_id`, `employee_id`, `gross`, `deductions`, `employer_contributions`, `net` (a snapshot frozen on approval; the ledger stays the source of truth) | unique (`run_id`, `employee_id`) |
| `payslip_lines` | `payslip_id`, `pay_item_id`, `quantity`, `rate`, `amount` | |
| `labour_allocations` | `payslip_id`, `project_id` (null = overhead), `basis` (`percent`), `quantity`, `amount` | deferred check: they total 100% of the payslip's cost |
| `advance_recoveries` | `employee_id`, `advance_transaction_id`, `instalment`, `start_month` | used to pre-fill runs; the balance is derived from 1300 Staff Advances by employee |

### 2.7 GST

| Table | Columns | Notes |
|---|---|---|
| `tax_periods` | `tax` (`gst`), `start_date`, `end_date`, `due_date`, `status` (`open`/`filed`/`paid`), `filed_at`, `filed_by`, `return_reference`, `settlement_transaction_id`, `payment_transaction_id` | unique (`tax`, `start_date`). Output, input and net totals are **not stored**: the view `gst_period_totals_v` sums journal lines by `tax_period_id` |

**Which quarter a GST line belongs to** (decision G4): at posting, each GST journal line gets the period that contains its date. If that period is already filed, it gets the **earliest open period** instead, and the line is flagged as a prior-period adjustment on the return.

**When input GST is claimable** (§8): the posting function sends GST to 1200 only if *all* of these hold:
- the vendor is `gst_registered`;
- the transaction has `supplier_tin`, `tax_invoice_no` and `tax_invoice_date`, or `customs_ref` for a customs import (G5);
- the line is `gst_claimable`.

Otherwise the GST is added to the line's own cost account (§3 "including the GST"). A table-level check trigger also refuses `gst_claimable = true` without that evidence, so the UI cannot bypass it.

### 2.8 Financing and profit share

| Table | Columns | Notes |
|---|---|---|
| `profit_schemes` | `name`, `effective_from date` | seeded from today's `profit_shares` (20/30/25/10/10/5) |
| `scheme_allocations` | `scheme_id`, `party_type` (`financing_pool`/`company`/`person`), `contact_id` (for persons), `percent numeric(7,4)`, `payable_account_id` | deferred check: a scheme's allocations total exactly 100 |
| `project_financing_v` (view) | per project and source contact: `source_type` (`external` if the account is under 2600, `capital_pool` if under 2700), amount received, amount repaid, `ratio = amount / Σ amount` (P4: amount only) | **derived** from posted `loan_receipt` and `capital_contribution` transactions, so there is no second copy |
| `distributions` | `project_id`, `scheme_id`, `profit_amount`, `reason` (`completion`/`bad_debt`/`late_entry`/`manual`), `status` (`preview`/`posted`), `journal_transaction_id`, `adjusts_distribution_id` | one `completion` distribution per project; adjustments point back to it |
| `distribution_lines` | `distribution_id`, `contact_id`, `component` (`financing_return`/`profit_share`), `amount`, `account_id` | principal is not part of a distribution: it is the loan itself |

**Payout gate** (§6, P3): posting a `payout` is refused by the database while the project's **client balance** is not 0. The client balance is AR plus Retention Receivable less Customer Advances, tagged to the project. This applies to all three components, including principal. The page shows the reason and the amount the client still owes.

### 2.9 Banking

| Table | Columns | Notes |
|---|---|---|
| `bank_imports` | `account_id`, `file_name`, `uploaded_by`, `uploaded_at` | |
| `bank_statement_lines` | `import_id`, `account_id`, `date`, `description`, `amount`, `balance`, `fingerprint`, `status` (`open`/`matched`/`added`/`excluded`), `journal_line_id`, `transaction_id` | unique (`account_id`, `fingerprint`); the existing CSV reader is reused |
| `bank_rules` | `name`, `priority`, `conditions jsonb` (description contains, amount range, direction), `account_id`, `contact_id`, `project_id`, `tax_code_id`, `active` | |
| `reconciliations` | `account_id`, `statement_date`, `ending_balance`, `status` (`in_progress`/`completed`/`undone`), `completed_at`, `completed_by` | can only complete when the difference is 0; only the latest one can be undone |

### 2.10 Chosen optional features

| Feature | Tables and mechanism |
|---|---|
| Purchase orders | `transactions` of type `purchase_order` (non-posting). Bill lines link via `po_line_id`. Committed cost = open PO lines − billed |
| Fixed assets | `assets` (existing, refactored): `asset_account_id`, `accumulated_account_id`, `depreciation_account_id`, `life_months`, `residual`, `bill_line_id`. The monthly `run_depreciation(month)` posts `depreciation` transactions; a disposal posts gain/loss |
| Recurring | `recurring_templates` (`type`, `template jsonb`, `interval`, `next_date`, `auto_post bool`, `active`). A Vercel Cron route runs once a day and creates drafts |
| Email and reminders | Reuses the Message Center. `reminder_rules` (7/14/30 days) are run by the daily cron |
| Bank rules and auto-match | §2.9 |
| FX revaluation | `revalue_fx(month_end)` posts `fx_revaluation` for USD accounts at the `exchange_rates` rate |
| Receipt scanning | The existing `extract-bill` feeds the new bill form |
| Approvals | `transactions.approval_status`. Bills above `settings.approval_limit_bill`, payroll runs and payouts need an admin (MD) approval before posting |
| Excel import | Upload templates for contacts, chart of accounts and opening balances; validated server-side and posted as one `opening_balance` transaction |
| Progress billing | `billing_stages` (§2.4) |
| Subcontractor compliance | View of vendors with expired licence or insurance; a warning on bill payment |
| Budget alerts | View: actual ≥ 80% / 100% of revised budget by category |
| Cash-flow forecast | Report: open invoices by due date, billing stages, open bills, next payroll, approved payouts |

### 2.11 Locks, audit and security

- **Closing date:** a trigger on `transactions` and `transaction_lines` refuses insert, update or void when the old *or* new date is on or before `settings.closing_date`. It covers opening balances and adjustments too.
- **Filed GST quarter:** the tax assignment in §2.7. Documents stay editable, but the filed return never changes; the difference goes into the next open return.
- **Audit:** `log_change()` on every new table, plus the existing ones not yet covered (A-31).
- **Writes:** `authenticated` gets **no direct insert, update or delete** on ledger tables. All writes go through `security definer` RPCs, which check `can_write()`, and payroll RPCs which check `can_see_payroll()`.
- **Reads:**
  - General ledger tables: `is_staff()`.
  - Payroll tables, payroll-tagged journal lines and payslips: `can_see_payroll()` (admin, finance or `can_payroll`).
  - Partner statements: `can_write()`.
- **Pages:** every page checks the role on the server, not just the sidebar (A-06).
- **Grants:** `revoke execute … from public` on helper and trigger functions (A-07).

---

## 3. Posting rules

Every rule runs inside `post_transaction(id)`, which deletes that transaction's journal lines and writes them again. Amounts are shown in the document currency; the home (MVR) amount = amount × `fx_rate`, rounded to 2 dp, with any rounding difference to 6220 FX Gain/Loss.

**Tag abbreviations used in the table:**
- **c** = contact, **p** = project, **e** = employee
- **T** = the tax period assigned by §2.7

| # | Type | Debit | Credit | Tags |
|---|---|---|---|---|
| 1 | `invoice` (incl. progress/stage) | 1100 AR = total | 4000/4010 per line = net; 2100 GST Output = tax | c, p (every line); GST line T |
| 1a | `invoice` with retention *(off, B1)* | 1100 AR (net of retention) + 1110 Retention Receivable | as 1 | c, p |
| 2 | `customer_payment` | 1040 Undeposited Funds, or the bank chosen | 1100 AR | c, p per applied invoice (split pro rata by application) |
| 3 | `deposit` | bank | 1040 Undeposited Funds | c |
| 4 | `sales_receipt` | bank / 1040 | revenue + 2100 | c, p, T |
| 5 | `credit_note` | revenue + 2100 | 1100 AR | c, p, T |
| 6 | `customer_advance` (B2) | bank | 2400 Customer Advances | c, p |
| 7 | `advance_application` | 2400 | 1100 AR | c, p |
| 8 | `bill`, GST claimable | cost/expense/asset per line (net) + 1200 GST Input | 2000 AP = total | c, p per line; GST line T |
| 9 | `bill`, GST not claimable | cost/expense/asset per line (net + GST) | 2000 AP | c, p |
| 10 | `bill_payment` | 2000 AP | bank | c, p per applied bill |
| 11 | `expense` / cheque | cost/expense (+1200 if claimable) | bank or 2010 Credit Card | c, p, T |
| 12 | `vendor_credit` | 2000 AP | cost/expense (+1200 reversed if claimable) | c, p, T |
| 13 | `transfer` | bank B | bank A | — |
| 14 | `journal` | as entered | as entered (must balance) | as entered |
| 15 | `opening_balance` | per account as imported | per account; the difference goes to 3900 Opening Balance Equity | c on AR/AP/loan lines, p on project balances |
| 16 | `bad_debt` | 6210 Bad Debts | 1100 AR (applied to the invoice) | c, p → triggers rule 26 |
| 17 | `loan_receipt` | bank | 2600 Project Loans – Lender | c, p |
| 18 | `capital_contribution` | bank | 2700 Capital Pool Loans – Person | c, p |
| 19 | `distribution` (§5, rule 25) | 6300 Finance Cost = the financing pool; 6310 Profit Share (or 3200 Dividends if `profit_share_debit = dividends`) = the fixed shares | 2800 Financing Return Payable – each source; 2900 Profit Share Payable – each person | p; c on every credit; `component` set |
| 20 | `payout` | one line per component: 2600/2700 (principal), 2800 (return), 2900 (share) | bank | c, p, component. **Gate §2.8** |
| 21 | `payroll_run` (on approval) | 5020 Direct Labour (site cost × each project %, including employer pension); 6000 Admin Salaries (admin gross); 6010 Employer Pension (admin employer share) | 2200 Salaries Payable (net); 2210 Pension Payable (employee + employer); 2220 WHT Payable; 1300 Staff Advances (recoveries); 2230 Other Deductions | e on every line; p on labour lines |
| 22 | `salary_payment` | 2200 Salaries Payable | bank | e (one line per employee) |
| 23 | `payroll_remittance` | 2210 Pension or 2220 WHT Payable | bank | — |
| 24 | `staff_advance` | 1300 Staff Advances | bank | e |
| 25 | `gst_settlement` | 2100 GST Output (the period's total) | 1200 GST Input (the period's total) + 2110 GST Payable – MIRA (net). If input > output: Dr 1210 Carry-forward for the difference instead (G3) | T |
| 25a | carry-forward use | 2110 GST Payable – MIRA | 1210 Carry-forward | next T |
| 26 | `distribution` adjustment (bad debt / late entry) | the split is recalculated on the new profit; each line's *difference* from what was already posted: positive → as 19, negative → reversed (Dr payable, Cr 6300/6310) | | p, c, component; `adjusts_id` → the original; the project is flagged for review |
| 27 | `gst_payment` | 2110 GST Payable – MIRA | bank | T |
| 28 | `wip_adjustment` *(POC only)* | earned > billed: 1120 Contract Asset. Billed > earned: 4000 Revenue | earned > billed: 4000 Revenue. Billed > earned: 2420 Contract Liability | p; auto-reversal dated day 1 of the next period (`reverses_id`) |
| 29 | `bpt_provision` (F3) | 6400 Income Tax Expense | 2300 BPT Payable | — |
| 30 | `fx_revaluation` | 6220 FX Gain/Loss, or the balance | the balance, or 6220 | c where the balance is a sub-ledger |
| 31 | `depreciation` | 6200 Depreciation | 1590 Accumulated Depreciation | p if the asset is allocated |
| — | `estimate`, `purchase_order` | no journal lines | | |

**The split calculator** (`split_profit(project_id, profit)`, SQL, all in laari):
1. `profit ≤ 0` → every share is 0 (P2); the company bears the loss.
2. `pool = floor(profit × 20%)`. Each financing source gets `floor(pool × amount_i / Σ amount)`, ordered by amount then name.
3. Each fixed person share = `floor(profit × pct)`.
4. The rounding remainder of the pool and person shares, and the Company's 30%, are **not posted**; they stay as profit (§5).
5. Test fixture: the §5 worked example must match to the laari.

**Project profit for the split** (P1): project-tagged income (4000–4900) − project-tagged job costs (5000–5060), including Direct Labour and non-claimable GST, as at completion. Overheads are excluded.

---

## 4. Migration plan (non-destructive, reversible)

- **SQL lives in the repo.** Every migration is a pair of files: `db/migrations/NNN_name.up.sql` and `NNN_name.down.sql`.
- **The same files run in two places:**
  - in the test suite, on PGlite (real Postgres in WebAssembly; confirmed working here);
  - on Supabase through the migration tool.
- **Down scripts** drop only objects that migration created; no existing row is altered or removed.

| # | Migration | What changes |
|---|---|---|
| 001 | `settings_rates_taxcodes` | settings, currencies, exchange_rates, rates (seed GST 6% to 2022-12-31 and 8% from 2023-01-01; pension 7%/7% 📝; WHT brackets 📝 empty until you supply them; BPT 15% over 500,000), tax_codes, document_sequences (seeded from today's quotation and invoice numbers) |
| 002 | `accounts` | chart of accounts and its seed |
| 003 | `contacts` | contacts, migrated from clients (2), vendors (39), investors (2 → lenders, A6), capital_pool_members (4 persons → partners; "Spruce & Co" → none, it is the company). Old tables are untouched |
| 004 | `employees_payitems` | employees from people (4), pay_items seed, employee_pay_items, employee_allocations |
| 005 | `ledger_core` | transactions, transaction_lines, journal_lines, applications, items, attachments, the balance trigger, lock triggers, `post_transaction`, `void_transaction`, `document_status_v` |
| 006 | `projects_value` | new project columns, variations number/amount, budget columns, billing_stages, `project_stage_v`, project value views |
| 007 | `payroll` | payroll_runs, payslips, payslip_lines, labour_allocations, advance_recoveries, the calculator functions |
| 008 | `gst` | tax_periods (generated from 2023 Q1), tax assignment, totals views, settle/pay functions |
| 009 | `financing` | profit_schemes (from profit_shares), scheme_allocations, distributions, distribution_lines, `split_profit`, the payout gate, adjustment logic |
| 010 | `banking` | bank_imports, bank_statement_lines, bank_rules, reconciliations. The existing bank_statements/bank_lines are empty, so nothing moves |
| 011 | `assets_recurring_po` | asset columns, recurring_templates, reminder_rules, PO support |
| 012 | `reports` | report views: TB, P&L, BS, CF, SOCE, aging, partner statement, and `health_check()` returning the §13 invariants |
| 013 | `security` | RLS, RPC-only writes, the payroll permission, revoking grants from PUBLIC |
| 014 | `opening_balances` | the opening-balance import (Excel template → one `opening_balance` transaction dated 31 Dec 2025, reviewed before posting). No historic data is imported (the deleted records were test data) |
| 015 | `cutover` *(later, with your OK)* | old money tables revoked to read-only; the old routes redirect |
| 016 | `cleanup` *(A9, after sign-off)* | drop `funding_rounds`, `commitments`, unused enums; drop the `backup_20260928` schema only when you say so |

The `backup_20260928` snapshot stays until the rebuild is signed off.

---

## 5. Folder structure

```
db/
  migrations/NNN_*.up.sql / .down.sql
  seed/                      chart of accounts, pay items, tax codes (also used by tests)
src/
  server/                    server-only (import "server-only")
    rpc/                     one typed wrapper per database function
    schemas/                 zod input schemas per document type
    auth.ts                  requireRole(), requirePayroll()
  lib/
    money.ts                 laari helpers: parse, format, compare (no floats)
    …existing (estimator, bank-csv, extract-bill, documents, format) kept
  components/
    ledger/                  TransactionForm, LineGrid, MoneyBar, StatusBadge, AccountPicker,
                             ContactPicker, ProjectPicker, TaxCodePicker, AttachmentList, AuditHistory
    reports/                 ReportShell (date presets, compare, filters, basis, export), DrillLink
    app-shell/               Sidebar, TopBar (search, + New, gear)
  app/(app)/                 routes per §6
tests/
  db/                        Vitest + PGlite: runs db/migrations, then the engine tests
  unit/                      TS helpers (money, csv, zod schemas)
  property/                  fast-check random sequences → health_check()
  e2e/                       Playwright specs (see §9 Q3)
```

New dev dependencies (A3, test tooling only): `vitest`, `@electric-sql/pglite`, `fast-check`, `@playwright/test`. **No runtime stack change.**

---

## 6. Routes and navigation

**Sidebar** (§10):
1. Dashboard
2. Sales
3. Expenses
4. Projects
5. Payroll
6. Partners & Financing
7. Banking
8. Taxes
9. Reports
10. Accounting
11. Settings

These stay reachable from the sidebar: Estimator, Tasks, Messages. **Top bar:** search, + New, settings gear.

| Area | Routes |
|---|---|
| Dashboard | `/` |
| Sales | `/sales` (money bar and all sales), `/sales/customers`, `/sales/customers/[id]` (tabs: transactions, projects, statement), `/sales/estimates` (= today's quotations, kept), `/sales/invoices`, `/sales/invoices/new`, `/sales/invoices/[id]`, `/sales/payments/new`, `/sales/receipts/new`, `/sales/credit-notes/new`, `/sales/deposits/new`, `/sales/advances/new` |
| Expenses | `/expenses` (all), `/expenses/vendors`, `/expenses/vendors/[id]`, `/expenses/bills/new`, `/expenses/bills/[id]`, `/expenses/pay-bills`, `/expenses/expenses/new`, `/expenses/vendor-credits/new`, `/expenses/purchase-orders` (+ `new`, `[id]`) |
| Projects | `/projects`, `/projects/new`, `/projects/[id]?tab=` overview · value · variations · transactions · labour · financing · split · payouts · documents |
| Payroll | `/payroll` (runs), `/payroll/runs/[id]`, `/payroll/employees`, `/payroll/employees/[id]`, `/payroll/pay-items`, `/payroll/advances`, `/payroll/remittances` |
| Partners & Financing | `/partners`, `/partners/[contactId]` (statement), `/partners/payouts`, `/partners/financing/new` (loan or contribution) |
| Banking | `/banking` (accounts), `/banking/[accountId]` (register), `/banking/import`, `/banking/reconcile/[accountId]`, `/banking/rules`, `/banking/transfer/new` |
| Taxes | `/taxes/gst`, `/taxes/gst/[periodId]` (worksheet, schedules, file, settle, pay), `/taxes/payroll`, `/taxes/bpt` |
| Reports | `/reports` (catalogue, saved reports), `/reports/[key]` (every §11 report through one ReportShell) |
| Accounting | `/accounting/chart`, `/accounting/chart/[id]`, `/accounting/journal/new`, `/accounting/journal/[id]`, `/accounting/close`, `/accounting/audit-log`, `/accounting/health`, `/accounting/assets`, `/accounting/recurring` |
| Settings | `/settings/company`, `/settings/accounting`, `/settings/taxes`, `/settings/payroll`, `/settings/numbering`, `/settings/templates` (today's editor), `/settings/currencies`, `/settings/schemes`, `/settings/users` |
| Print | `/print/invoices/[id]`, `/print/estimates/[id]`, `/print/payslips/[id]`, `/print/statements/[customerId]`, `/print/reports/[key]` |

**Old routes after cut-over** redirect to their new homes:
- `/clients` → `/sales/customers`
- `/shops` → `/expenses/vendors?view=trade`
- `/invoices` → `/sales/invoices`
- `/quotations` → `/sales/estimates`
- `/salaries` and `/people` → `/payroll`
- `/capital-pool`, `/investors`, `/financing`, `/internal` → `/partners`
- `/profit-share` → `/settings/schemes`
- `/gst` → `/taxes/gst`
- `/pnl` → `/reports/project-value`
- `/accounting/*` → `/reports` / `/accounting/*`

**+ New menu:**
- **Customers:** invoice, payment, estimate, sales receipt, credit note, deposit, advance.
- **Vendors:** bill, pay bills, expense, vendor credit, purchase order.
- **Employees:** payroll run, staff advance, remittance.
- **Projects & Financing:** project, variation, loan received, capital contribution, payout.
- **Other:** journal entry, transfer, bank deposit, GST payment.

---

## 7. Test plan

| Layer | Tool | Where it runs | What it covers |
|---|---|---|---|
| Engine and posting | Vitest + PGlite | here, and in CI | every §3 rule gives the exact lines and balances; the unbalanced-commit refusal; void; edit regenerates lines; closing-date lock |
| Split | Vitest + PGlite | here, and in CI | §5 worked example (exact); zero profit; loss (P2 → zeros); single financier; external-only; no financing; rounding remainder; partner with no contribution; bad-debt adjustment journal; late-entry adjustment and flag |
| Payroll | Vitest + PGlite | here, and in CI | gross → net with pension 7%/7% and WHT brackets from fixtures; no-pay; advance recovery; allocations must total 100; payment and remittances clear their payables |
| GST | Vitest + PGlite | here, and in CI | quarter totals; non-claimable GST to cost; no claim without TIN and tax invoice number (refused by the DB); filing locks the quarter and moves late lines to the next return; settlement zeroes the quarter; carry-forward |
| Project value | Vitest + PGlite | here, and in CI | variations update the revised value; % complete (cost-to-cost); over/under billing; POC WIP posts and auto-reverses |
| Payout gate | Vitest + PGlite | here, and in CI | refused while the client balance is above 0; allowed at 0 or after a write-off |
| Derived values | Vitest | here, and in CI | status derivation, aging buckets, FX conversion, laari rounding |
| Invariants | `health_check()` SQL | after every DB test; on real data via `/accounting/health` | the 13 invariants in §13 |
| Property | fast-check + PGlite | here, and in CI | random valid sequences (sales, bills, payroll, GST quarters, financing, voids, edits) → `health_check()` is clean |
| Build | tsc, eslint, next build | here, and in CI | 0 errors |
| End-to-end | Playwright | **see §9 Q3** | full project lifecycle; GST quarter; bad-debt path (§13) |

---

## 8. Build order (Phase 3 → 4, as the spec sets it)

- **Phase 3 (engines, test-first):** migrations 001, 002, 005, 006, 007, 008, 009 and 012 in PGlite, with every engine test and `health_check()` passing. No UI yet.
- **Phase 4 (modules, in spec order):** Settings & CoA → Contacts → Projects & Value → Sales → Expenses → Payroll → Banking → Taxes → Financing & Profit Share → Reports → Dashboard. Each ends with tests, a commit and a 3-line summary.

---

## 9. Needs your answer before Phase 3

**Q1. Resolved (28 Sep).** The deleted records were test data. Nothing is imported: the ledger starts empty, and real opening balances as at 1 January 2026 are entered through the opening-balance import (migration 014 creates the empty import, not figures).

**R1. Is the remaining reference data real?** There are 39 vendors, 2 clients, 2 investors, 4 people, 5 capital-pool members and 4 signatories.
- **Suggested default:** the vendors, pool members, signatories and profit scheme are real and are migrated.
- The 2 clients, 2 investors and 4 people are migrated too, but marked "check", so you can archive any test entries.

**Q2. Where do we try the new screens before cut-over?**

Vercel preview deployments use the same production database. My proposal:
- a **Supabase development branch** (a separate copy of the database, charged by Supabase per hour it runs) for the preview; or
- keep new tables in production (non-destructive) and test only with clearly marked test records.

**Recommendation:** a dev branch.

**Q3. End-to-end browser tests need a Supabase they can reach.**

This sandbox cannot reach Supabase, and has no Docker daemon to run one locally. **Proposal:** a GitHub Actions workflow that runs the E2E suite on each push to `rebuild/accounting`, against the dev branch from Q2. It needs its connection keys stored as GitHub secrets, which you add once. All other tests (engines, invariants, property) run here without it.

**Q4. Figures still to come (📝).** These are not needed for Phase 3, which uses test fixtures, but they are needed before the first real payroll run and GST filing:
- confirmed pension rates;
- the WHT brackets;
- the GST due day;
- staff headcount;
- whether an old "Investor Split" model ever applied to past projects.
