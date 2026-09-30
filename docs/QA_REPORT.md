# QA report

Kept up to date as the rebuild goes. The latest run is at the top.

## Phase 3 — engines (28 Sep 2026)

**How it is tested**
- Every database migration runs on a local copy of Postgres (PGlite, Postgres 18 in WebAssembly). The same SQL files will later be applied to Supabase.
- The starting point is a copy of production's schema (`db/baseline/existing.sql`).
- **After every test scenario, the Health Check (§13 invariants) must pass.**
- Command: `npm test`.

| Area | File | Tests | Result |
|---|---|---|---|
| Settings, rates, accounts, contacts | `tests/db/foundation.test.ts` | 6 | ✅ |
| Posting rules (§3), void, delete, closing-date lock, applications, derived status, FX | `tests/db/posting.test.ts` | 28 | ✅ |
| Project value (§4): variations, % complete, over/under billing, ledger profit, POC WIP + reversal, stage | `tests/db/project-value.test.ts` | 6 | ✅ |
| Payroll (§7): gross to net, pension, WHT brackets, no-pay, advances, allocation = 100%, posting, payment, remittance | `tests/db/payroll.test.ts` | 6 | ✅ |
| GST (§8): quarter totals, non-claimable to cost, claim needs TIN and tax invoice, filing lock and next-return adjustments, settlement, payment, carry-forward, filing order | `tests/db/gst.test.ts` | 5 | ✅ |
| Profit split and payouts (§5, §6): worked example exact, zero, loss, single financier, external-only, no financing, rounding, dividends setting, scheme = 100%, scheme at start, payout block, over-payout, bad-debt adjustment, late entry and review flag | `tests/db/financing.test.ts` | 11 | ✅ |
| Property (§13): 25 random sequences of up to 30 steps (sales, payments, bills, voids, edits, payroll, GST returns, financing, completion, bad debts, payouts) | `tests/db/property.test.ts` | 1 | ✅ |
| Migrations are reversible and non-destructive | `tests/db/migrations.test.ts` | 1 | ✅ |
| **Total** | | **64** | **✅ all pass** |

A one-off stress run of **150 more random sequences** (seed 7) also passed.

**Bugs the tests caught, all fixed:**
- An invoice could be edited below what had already been paid on it. The property test found this; posting now refuses.
- Receivable and payable lines could be posted without a customer or vendor. Found by Health Check #4.
- A GST payment could be posted outside a filed return. Found by Health Check #9.
- In the payroll trigger, the remittance posting and the split calculation, where the tests caught them.

**Build:**
- `tsc`: 0 errors
- `eslint --max-warnings 0`: clean
- `next build`: OK

**The 13 invariants** (`health_check()`, also for the Health page on real data):

| # | Invariant | Status |
|---|---|---|
| 1–9, 12, 13 | as in §13 | checked directly |
| 10 | Cash flow = change in cash | follows from 2 and 3 for now; checked directly once the cash-flow report is built (Phase 4, Reports) |
| 11 | Equity statement = balance-sheet equity | follows from 3 for now; checked directly once the equity report is built (Phase 4, Reports) |

## Applied to the live database (30 Sep 2026)

Migrations 001–009, 012, 013 and the new 014 (hardening) were applied in order to Supabase project `uiemghogknbvxuqstwio`, after the `backup_20260928` snapshot. Nothing was dropped or deleted; the old tables are unchanged apart from added columns.

| Check | Result |
|---|---|
| Health Check, Live book | all 13 pass (the ledger is empty) |
| Chart of accounts | 61 system accounts + 8 partner sub-accounts (Capital Pool Loan and Profit Share Payable for each of the 4 partners) |
| Contacts copied | 2 customers, 39 vendors, 2 lenders (all marked *needs review*), 4 partners |
| Employees copied | 4 (marked *needs review*: salary, nationality and bank details were never recorded) |
| Profit scheme | 20 financing pool / 30 company / 25 Mujahid / 10 Muaz / 10 Mushahid / 5 Mariyam Zahir, linked by id |
| Smoke test, rolled back | a Test-book invoice numbered `TEST-SC-INV/26/001`: Dr AR 1,080 / Cr Revenue 1,000 / Cr GST 80 (8%) in its return period; Live untouched; nothing kept |
| Supabase security advisor | the 67 "mutable search_path" warnings on the new functions are fixed by 014. Left as designed: the `rpc_*` functions are callable by signed-in users (that is their job; each checks role and book). Left from before, not part of this rebuild: `pg_trgm` in `public`, older helper functions callable by `anon`, leaked-password protection off |

## Phase 4 · Module 1 — Settings & Chart of Accounts (30 Sep 2026)

| Area | What was built | Checked by |
|---|---|---|
| Live / Test | Switch in the top bar; amber banner in Test; screens still on the old tables are hidden in Test (sidebar and direct links); admin "Reset the Test book" (type RESET) | `security.test` (books never mix, reset leaves Live untouched) |
| Settings | Tabs: Company · Accounting (closing date, opening-balance date, financial year, revenue recognition, profit-share charge, bill approval limit, GST period and due day, no-pay divisor) · Taxes & rates · Numbering · Currencies | `settings.test` |
| Rates | Dated history per rate; a rate in force can't be edited or removed; new rates from a date; bracket editor for withholding tax and BPT, checked for gaps and overlaps; warning while withholding-tax brackets are missing | `settings.test` (5 cases) |
| Numbering | Per book; admin only; refuses a number already issued; Test numbers must start `TEST-` | `settings.test` |
| Chart of accounts | Grouped by type with balances for the current book, sub-accounts nested and rolled up; add account (bank accounts, fixed assets, job-cost categories); edit name, code (non-system), description; switching off refused while it has a balance | build, types |
| Account register | Every line with a running balance, oldest first; note when payroll lines are hidden from the viewer | `money.test` (running balance in laari) |
| Health check | `/accounting/health` runs the 13 checks on the current book | `health_check` after every DB test |
| Money on screen | Amounts parsed and summed as whole laari (`src/lib/money.ts`), never as floats | `money.test` (incl. property test) |

Migration 015 (balances RPC, numbering RPC, rate guard) is applied to Live. Tests: **78 passing** (was 68). `tsc`, `eslint` and `next build` are clean.
Not verified here: clicking through the screens against the live database. This sandbox cannot reach Supabase; the Playwright suite in CI (Q3) will cover it.

## Phase 4 · Module 2 — Contacts (30 Sep 2026)

| Area | What was built | Checked by |
|---|---|---|
| Customers `/sales/customers` · Vendors `/expenses/vendors` | One contact list, two views; totals owed and overdue; Active / Needs review / Archived; search; "also a vendor" marker for contacts on both sides | `contacts.test` |
| Balances | `contact_balances_v` (016): owed = the contact's AR or AP lines; overdue = unpaid part of invoices or bills past due; drafts and voids ignored; per book | `contacts.test` (3 cases) |
| Detail tabs | Transactions (status derived), Projects (customers), Statement (date range, balance brought forward, running balance, print), Details (edit) | `contacts.test`, `doc-status.test` (screen status = database status, 200 random cases) |
| Add / edit | Customer, vendor, lender; TIN required when GST-registered; duplicate name or TIN refused unless confirmed; what was typed is kept when a save is refused | build, types |
| Review of copied contacts | "Confirm it is real" clears the flag; Archive is refused while the contact has an open balance; Restore | build, types |

Migration 016 applied to Live. Tests: **84 passing**. `tsc`, `eslint` and `next build` are clean.
**Clients merged into Customers (migration 017):** the Clients screen is removed and `/clients` opens Customers. The project form picks a customer (or adds one). Every Live customer has a mirrored row in the old `clients` table, which quotations, invoices and the estimator still read; a client added by one of those older screens appears as a customer; a project's customer and old client field always agree. Checked by `customers-clients.test` (4 cases). On Live: 2 clients = 2 customers, none unmirrored. Tests: **88 passing**.
The old Shops screen still writes to its own table until the Expenses module.

## Phase 4 · Module 3 — Projects & Project Value (30 Sep 2026)

| Area | What was built | Checked by |
|---|---|---|
| Project list `/projects` | Works in Live and Test; per project: stage, contract value (with approved variations), billed and %, collected, cost, forecast profit, margin, client balance; totals; archived view | `projects.test` (list view ties to the ledger) |
| Project page tabs | Overview (value, billing, collection, cost, forecast, % complete, over/under billing, actual profit) · Value & budget (budget vs actual vs forecast by category, variance) · Variations · Billing plan · Transactions | `project-value.test`, `projects.test` |
| Budget lines | Add, edit, delete by job-cost category with revised budget and forecast to complete (blank = what is left of the budget) | `project-value.test` |
| Variations register | Raise (VO-01…), approve with a date, reject, withdraw, reopen; only approved ones move the contract value | `projects.test` |
| Billing plan | Stages by percent or fixed amount, worked out in laari; warns when the plan is over or under the contract; invoiced stages cannot be removed | `money.test` (percentOf) |
| Recognition | Per project: as billed, percentage of completion, or the company default; "Post WIP" at a period end for POC projects (auto-reversed next day) | `project-value.test` (run_wip) |
| Book safety | A project's variations, budget lines and billing stages follow its book (migration 018) | `projects.test` |
| Old view | The earlier project page (bill uploads, investments, old profit-share card, quotations) moved to `/projects/[id]/legacy`, Live only, until Sales, Expenses and Financing replace those parts | `money.test` (Live-only route rule) |

Project amounts on the form are now saved as exact decimals (no floats). Migration 018 applied to Live. Tests: **93 passing**; `tsc`, `eslint`, `next build` clean.

## Phase 4 · Module 4 — Sales (30 Sep 2026)

| Area | What was built | Checked by |
|---|---|---|
| Sales hub `/sales` | Money bar: Unpaid · Overdue · Paid in the last 30 days · Not yet banked; every sales document with customer, project, balance and derived status; filters | `sales.test` (list and "paid since") |
| Invoices, credit notes, sales receipts | One form: customer (terms set the due date; none = due on receipt), project, lines by quantity × rate or amount, GST code per line, income account, MVR or USD with rate, draft; running total in laari; edit re-posts; void with a reason | `posting.test`, `money.test` (quantity × rate) |
| Document page | Lines with GST, totals, payments applied, where the money went, void notice; Print / PDF; Receive payment; Mark sent; Edit; Void | build, types |
| Tax invoice PDF `/print/sales/[id]` | Supplier name, TIN and GST registration; customer and their TIN; number, date, due date; each line with its GST; subtotal, GST, total, paid, balance; bank details; "VOID" when voided; titled INVOICE when not GST-registered | build, types |
| Receive payment | One payment across a customer's open invoices, oldest first, each editable; over-applying refused; the rest stays as credit; to a bank or Undeposited Funds | `sales.test` |
| Bank deposit | Tick receipts waiting in Undeposited Funds; the deposit records which ones, so none is banked twice; voiding it frees them; a banked receipt can't be voided | `sales.test` (2 cases) |
| Client advances (B2) | Receive an advance; balances held per customer; apply to invoices; the database refuses using more than was paid (migration 020) | `sales.test` |
| Progress billing | "Create invoice" on a billing stage makes the invoice for its share of the revised contract (GST by registration; customer's terms); voiding it frees the stage | `sales.test` (2 cases) |
| Customer statement PDF `/print/statement/[id]` | From the Statement tab, for any dates | `contacts.test` |

Migrations 019 and 020 applied to Live. Tests: **100 passing**; `tsc`, `eslint`, `next build` clean.
Estimates stay on the existing Quotations screens (Live only) for now; converting a quotation into a new-ledger invoice and e-mailing invoices with reminders are listed under Still open.

## Phase 4 · Module 5 — Expenses (30 Sep 2026)

| Area | What was built | Checked by |
|---|---|---|
| Expenses hub `/expenses` | Money bar: Unpaid bills · Overdue · Paid in the last 30 days · Awaiting approval; every bill, expense, payment, vendor credit and purchase order with vendor, project, balance and status | `expenses.test` |
| Bill, expense, vendor credit, purchase order | One form: vendor (terms set the due date), project, lines by account (job costs, overheads, assets) with quantity × rate or amount, the supplier's own GST figure (or one tap for the current rate), "claim it back" per line, tax-invoice evidence (TIN, number, date, customs); GST not claimed is added to cost; MVR or USD | `posting.test`, `gst.test` |
| Receipt scanning | "Read the photo" fills vendor (matched by TIN, then name), TIN, invoice number, date, amount and GST, using the server reader when set up, otherwise on the device; the photo is kept with the document | build, types |
| Approval workflow | A bill over the limit in Settings is saved as a draft and sent to an admin (an admin's own bill is approved as saved); it posts only on approval and only up to the approved amount; the database refuses otherwise | `expenses.test` |
| Pay bills | Tick bills across vendors; one payment per vendor, applied to its bills, all or nothing; warns when a vendor's licence or insurance has expired | `expenses.test` |
| Vendor credits | Applied to the vendor's open bills from the credit's page | `expenses.test` |
| Purchase orders | Open orders count as committed cost on the project, by category; "Turn into a bill" copies the lines into a draft bill and closes the order; close or reopen | `expenses.test` |
| Budget alerts | Project Value tab flags a category past 80% or 100% of its revised budget, counting open orders | build, types |
| Shops → Vendors | The Shops screen is removed; `/shops` opens Vendors; every Live vendor is mirrored in the old vendors table for the older screens, and a shop added there becomes a vendor (39 on Live, all in step) | `expenses.test` |

Migration 021 applied to Live. Tests: **105 passing**; `tsc`, `eslint`, `next build` clean.

## Still open

| Item | Why | When |
|---|---|---|
| Banking (010), assets / recurring / purchase orders (011) | Their modules come later in Phase 4 | Phase 4 |
| Save/void RPCs called by the screens | Written per module | Phase 4 |
| End-to-end browser tests | Need a reachable Supabase (Q3) | Phase 4–5 |
| Withholding-tax brackets, pension-rate confirmation, GST due day | Your figures (📝) | Before the first real payroll / GST filing |
| Assumptions I1–I9 | Your confirmation | Any time |
| Estimates in the new books (convert a quotation to a new-ledger invoice); e-mail invoices and overdue reminders (feature H) | Quotations have their own templates and signatures; kept as they are until switch-over | Phase 5 cut-over |
