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
Until cut-over the old Clients and Shops screens still write to the old tables; a client added there does not appear under Customers. Module 3 (Projects) moves project customers onto the new contacts.

## Still open

| Item | Why | When |
|---|---|---|
| Banking (010), assets / recurring / purchase orders (011) | Their modules come later in Phase 4 | Phase 4 |
| Save/void RPCs called by the screens | Written per module | Phase 4 |
| End-to-end browser tests | Need a reachable Supabase (Q3) | Phase 4–5 |
| Withholding-tax brackets, pension-rate confirmation, GST due day | Your figures (📝) | Before the first real payroll / GST filing |
| Assumptions I1–I9 | Your confirmation | Any time |
