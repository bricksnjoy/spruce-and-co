# Phase 0 — Audit

Date: 28 September 2026 · Branch: `rebuild/accounting` (from `claude/jolly-cannon-i4y7vh` at `b705c82`) · No application code changed in this phase.

## 0. Headline findings

1. **The live books are nearly empty.** *(Update 28 Sep: you confirmed the deleted records were test data, so no real data was lost. A-01 still stands, because the delete button could have done the same to real data. It was replaced by Archive in `3cf457a`.)* Between 12:43 and 12:58 UTC on 27 September one admin account deleted:
   - 3 projects
   - 105 bills
   - 64 profit-share entries
   - 32 capital-pool entries
   - 6 financing sources
   - 2 variations
   - 1 invoice, 1 quotation, 1 salary payment, 1 client and 1 vendor

   What is left is reference data only. Every deleted bill, project, pool and profit-share row is kept in full in `audit_log`, so these can be recovered. Rows in tables that have no audit trigger (budget lines, milestones, per-project share overrides, capital-pool contribution ratios) are gone for good.
2. **There is no real ledger today.**
   - "Accounting" is a journal *derived in TypeScript on every page load* (`src/lib/statements.ts`, `src/lib/accounting.ts`), using JavaScript floats, from operational tables that store balances and statuses directly.
   - Nothing is posted, nothing enforces debits = credits, and invoice and bill statuses are set by hand.
   - The rebuild needs a stored, database-enforced double-entry ledger. It is a rebuild, not a refactor.
3. **Role security is menu-deep only.** Payroll, profit shares, the capital pool and the accounting pages are hidden from the `viewer` role in the sidebar. But the pages open by URL, and row-level security lets *any* signed-in staff member read them. A `can_see_payroll()` helper exists but no policy uses it. Today this is latent, because both user accounts are admins.
4. **Multi-step money writes are not atomic.** Completion, payment, quotation save and invoice conversion each do delete-then-insert across several requests. A failure part-way leaves the data half-written, and several delete errors are ignored.
5. **Build health is good:**
   - `npm ci`, `tsc` and `eslint` pass with 0 errors, and `next build` succeeds.
   - There is **no test suite at all**.

---

## 1. Stack, structure, config

| Area | What is there |
|---|---|
| Framework | Next.js 16.3.5 (App Router, Turbopack), React 19.2, TypeScript 5, Tailwind 4 |
| Data | Supabase: Postgres 17.6, Auth, Storage (private buckets `documents`, `bills`, `slips`, `branding`). Project `uiemghogknbvxuqstwio`, ap-south-1 |
| Hosting | Vercel project `spruce-backoffice`; the branch `claude/jolly-cannon-i4y7vh` deploys to production |
| Libraries | `@supabase/ssr`, `exceljs` (Excel), `three` (3D kitchen), `tesseract.js` (OCR), `zod`, `@anthropic-ai/sdk` + `@google/genai` (bill extraction) |
| Messaging | Resend (email), MsgOwl (SMS) |
| Tests | None. No test runner is installed |

**Folders**
- `src/app/(app)/*`: signed-in pages.
- `src/app/actions/*`: 23 server-action files.
- `src/app/print/*`: A4 print pages.
- `src/lib/*`: 26 domain modules. The largest are `estimator.ts` (880 lines), `kitchen.ts` (855), `statements.ts` (506) and `accounting.ts` (407).
- `src/components/*`: 14 shared UI files.
- `src/middleware.ts`: redirects signed-out users to `/login`.
- In total: 203 TS/TSX files, about 28,000 lines.

**Env/config**
- `.env.example` lists only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- The code also reads `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `MSGOWL_API_KEY` and `MSGOWL_SENDER_ID`. See A-24.

**Auth and roles**
- Supabase email/password.
- `profiles.role` is one of `admin | manager | finance | viewer`.
- Database helpers:
  - `is_staff()`: any active profile.
  - `can_write()`: admin, manager or finance.
  - `is_admin()`
  - `can_see_payroll()`: admin or finance, **unused**.
- There are 2 profiles, both admin.

## 2. Routes and pages (53)

| Group | Routes |
|---|---|
| Overview | `/` dashboard, `/projects`, `/projects/new`, `/projects/[id]`, `/projects/[id]/edit`, `/clients`, `/shops`, `/shops/[id]`, `/tasks`, `/messages`, `/pnl` |
| Sales | `/quotations` (+ `new`, `[id]`, `[id]/edit`, `templates`, `templates/[id]`, `signatures`), `/invoices`, `/invoices/[id]`, `/estimator`, `/estimator/setup` |
| People | `/people`, `/people/[id]`, `/salaries` |
| Partners and financing | `/capital-pool`, `/investors`, `/investors/[id]`, `/financing`, `/internal`, `/profit-share` |
| Accounting | `/accounting`, `/accounting/ledger` (+ `csv`), `/accounting/statements` (+ `xlsx`), `/accounting/bank`, `/accounting/tax`, `/accounting/equipment`, `/accounting/year-end`, `/accounting/audit`, `/gst`, `/gst/export` |
| Settings | `/settings` (company), `/profit-share` |
| Print | `/print/invoices/[id]`, `/print/quotations/[id]`, `/print/statements` |
| Public | `/login` |

## 3. Database (public schema)

- **47 tables and 8 views.** All tables have RLS enabled. All views are `security_invoker`, so they apply the RLS of the tables underneath.
- **Migration history:** 60 migrations. Seed demo data was later replaced with real data.
- **Unused enums:** 30 or more are left over from tables that were dropped in `reduce_schema_to_core` (tender, RFI, PO, stock, permit, weather, etc.).

**Tables by area**
- **Core:**
  - `projects` (contract_value, gst_amount, completed_at, payment_received_at/amount, financing_repay_pct)
  - `clients`
  - `vendors` (tin)
  - `cost_categories`
  - `variations`
  - `budget_lines`
  - `project_phases`, `project_tasks`, `milestones`
- **Money in:**
  - `quotations` and `quotation_items`
  - `invoices` and `invoice_items`: status is set by hand, and payment is only `paid_at`
  - `invoice_totals` and `quotation_totals` (views)
- **Money out:** `bills`, holding subtotal, tax_amount, total, amount_paid, a status set by hand, gst_rate and expense_class.
- **Financing and profit share:**
  - Share scheme: `profit_shares` (the scheme, not versioned) and `project_profit_shares` (per-project override).
  - Project financing: `project_financing_sources` (external_loan, capital_pool or investor) and `capital_pool_contributions` (ratios within a pool source).
  - Capital pool and profit-share ledgers: `capital_pool_members`, `capital_pool_entries` and `internal_account_entries` (the accrual/settlement ledger).
  - Investors: `investors`, `investor_repayments` and `investor_paid_marks`.
  - Views: `project_profit_split`, `project_pnl`, `investor_balances`, `internal_account_balances` and `finance_summary`.
  - `funding_rounds` and `commitments` are unused.
- **Payroll (thin):** `people`, `salary_plans` and `salary_payments`. There are no payslips, deductions, pension or WHT. Salaries are paid out of a pool member's balance.
- **Added on 27 September:**
  - `audit_log`, `audit_marks` and `audit_reviews`
  - `bank_statements` and `bank_lines`
  - `tax_payments`, `tax_returns`, `assets` and `financial_years`
  - a closed-year guard trigger on 10 money tables
- **Other:**
  - estimator: `cabinet_*` and `estimator_settings`
  - `document_templates`, `signatories`, `messages`
  - `company`: a single row holding share capital, BPT rate/threshold, asset life and opening cash

**Money types**
- Most amounts are `numeric(14,2)`. That is fine and exact.
- 14 newer columns (`assets.*`, `bank_lines.*`, `tax_payments.amount`, `tax_returns.*`, `company.share_capital` and `company.opening_cash`) are unconstrained `numeric`. See A-18.
- In the app, every amount is converted to a JavaScript float (`Number(...)`), and totals are summed in floats.

**Supabase security advisor**
- 11 SECURITY DEFINER functions can be executed by `anon`: `is_staff`, `can_write`, `is_admin`, `can_see_payroll`, `current_role_of`, `year_closed` and 5 guard trigger functions.
- `pg_trgm` is installed in `public`.
- Leaked-password protection is off.

## 4. Data inventory (28 Sep 2026)

| Kept (reference data) | Rows | Emptied |
|---|---|---|
| vendors | 39 | projects 0 |
| cost_categories | 15 | bills 0 |
| capital_pool_members | 5 | invoices / quotations 0 |
| profit_shares (scheme) | 6 | capital_pool_entries 0 |
| people | 4 | internal_account_entries 0 |
| signatories | 4 | project_financing_sources 0 |
| clients | 2 | salary_payments / plans 0 |
| investors | 2 | variations, budget_lines 0 |
| document_templates | 2 | |
| company | 1 | |
| cabinet_materials / parts | 10 / 24 | |
| audit_log | 279 | holds the deleted rows |

**Backup:** a full copy of all 47 tables was taken as schema `backup_20260928` (migration `backup_snapshot_20260928`). It is not reachable through the API, and nothing was changed or deleted. (The sandbox cannot reach Supabase directly, so a file export was not possible from here. Supabase's own daily backups also apply.)

**Proposal:** start fresh with **opening balances** as at a date you choose, most likely 1 January 2026 or the date the new system goes live. Migrate the reference data into the new structures:
- vendors, clients and investors → `contacts`
- people → `employees`
- `profit_shares` → the first version of the profit scheme
- pool members → partner contacts with sub-accounts
- company, templates and signatories → kept as they are

The deleted 2025–26 transactions are all recoverable from `audit_log`: 105 bills, 3 projects, pool and profit-share history. Two options for them:
- (a) re-enter them as source documents so they post properly; or
- (b) use them only to work out opening balances.

I recommend (b) unless the auditor needs transaction-level history for 2026.

## 5. Feature map to target modules (§9)

| Existing feature | Target module | Verdict |
|---|---|---|
| Projects list/detail, codes, status, progress, phases, tasks | Projects | **Refactor**: add customer link, Active→Completed→Settled→Closed statuses and derived value figures; keep tasks and phases |
| Variations | Projects / Variations | **Refactor**: numbering and pending/approved/rejected |
| Budget lines by category | Project Value & Budget | **Refactor**: add revised budget and forecast-to-complete |
| Project P&L view (`project_pnl`) | Project reports | **Rebuild** from the ledger |
| Clients, Vendors, Investors, pool members, people | Contacts / Employees | **Rebuild** into `contacts` (kind) and `employees`, migrating the data |
| Quotations, templates, signatures, PDF print | Sales / Estimates | **Keep** (estimate → invoice conversion stays); numbering moves to settings |
| Invoices (portion of a quotation, status by hand) | Sales / Invoices | **Rebuild** as posted transactions, with payments and derived status |
| Bills with OCR/AI extraction, vendor fuzzy match, GST input schedule | Expenses / Bills | **Refactor**: keep the capture flow (valuable); rebuild storage as posted transactions with tax-invoice fields and claimable logic |
| Salary plans paid from pool balances | Payroll | **Rebuild**: employees, pay items, runs, payslips, allocation |
| Capital pool, financing sources, investors, repayments, paid marks | Partners & Financing | **Rebuild** on project financing, loan sub-accounts and payouts |
| Profit share scheme, per-project overrides, split view, internal account | Financing & Profit Share | **Rebuild**: versioned schemes, split calculator, distribution journals, payout rules §6 |
| Accounting overview, ledger, statements, year end, Excel/PDF | Reports & Financial Statements | **Rebuild** on the stored ledger; reuse the print layout and Excel export code |
| Bank CSV import and matching | Banking | **Refactor**: keep the CSV parser; add registers, cleared status and reconciliation with ending balance |
| Tax payments, BPT worksheet | Taxes | **Refactor** into GST quarters and a BPT provision |
| Equipment register | Fixed assets (optional §16) | **Keep** if chosen; post depreciation to the ledger |
| Closed-year guard triggers | Closing-date lock | **Rebuild** as the settings closing date plus GST quarter locks |
| Self-audit checks, sign-offs, change log | Accounting / Health Check | **Keep** the change log; turn the checks into the invariant Health Check |
| Cabinet estimator (2D/3D, cut lists) | Outside accounting | **Keep** as is; link estimates to projects |
| Message center (SMS/email) | Global | **Keep**; reuse for emailing invoices and reminders |
| Shops (vendor directory by trade) | Contacts | **Refactor** into the vendor view |
| Project delete (added 27 Sep; hard-deletes bills) | — | **Remove**: posted documents must be voided, never deleted (§1) |
| `funding_rounds`, `commitments`, 30+ dead enums | — | **Remove** once you approve (both tables are empty) |

## 6. Issues

Severity: **Critical** = money wrong or data loss possible now · **High** = security or integrity gap · **Medium** = wrong in edge cases · **Low** = hygiene.

| # | Where | Severity | Issue | Proposed fix |
|---|---|---|---|---|
| A-01 | `src/app/actions/projects.ts:169`, `src/app/(app)/projects/[id]/edit/delete-project.tsx:9` | Critical | Project delete hard-deletes the project's bills; "also delete bills" is ticked by default. This is how 105 bills were lost. | Remove hard delete; replace with void or archive. Posted documents are never deleted (§1). |
| A-02 | `src/app/actions/project-items.ts:334`, `documents.ts:441`, `clients.ts:85` | High | Bills, unpaid invoices and clients are hard-deleted. The delete error is ignored (`await … .delete()` with no check). | Void instead of delete; check every write result. |
| A-03 | `src/app/actions/project-status.ts:79-87, 182-188, 212-220, 233-242` | High | Completion and payment do delete-then-insert across separate requests with no transaction. Delete errors are ignored. A failure part-way leaves duplicate or missing accruals. | Do each posting in one database function (a single transaction). |
| A-04 | `src/app/actions/documents.ts:233-265` | High | Saving a quotation updates the header, deletes all lines, then inserts new lines. If the insert fails, the quotation is left with no lines. | Single transactional RPC. |
| A-05 | `src/app/actions/documents.ts:376, 390` | Medium | Invoice conversion checks "remaining to invoice" and then inserts. Two users at once can invoice more than 100% of a quotation. | Enforce in the database (constraint or trigger on the summed portion), or post inside a locked transaction. |
| A-06 | RLS on `salary_*`, `people`, `capital_pool_*`, `internal_account_entries`, `investor_*`, `audit_log` read, and `src/lib/nav.ts:18` | High | Money and payroll pages are hidden from `viewer` only in the sidebar. The URL still works and RLS `is_staff()` lets any staff member read the rows. `can_see_payroll()` is defined but never used. | Page guards by role, plus RLS using `can_see_payroll()` / `can_write()` for reads of sensitive tables. |
| A-07 | Migration `books_year_end` (the guard functions), plus `is_staff`, `can_write`, `is_admin`, `can_see_payroll`, `current_role_of` | Medium | SECURITY DEFINER functions are executable by `anon` via `/rest/v1/rpc`. My revoke named `anon`/`authenticated`, but the grant is to PUBLIC. Low impact (they only return booleans or raise), but it is an advisor warning. | `revoke execute … from public` and grant only to `authenticated` where needed; trigger functions need no grant. |
| A-08 | `project_pnl` view | Critical (for §5/§6) | Project profit = contract value + approved variations − bill **totals**. Three errors: it ignores labour (salaries are never tagged to projects); it uses bill totals *including GST* (even claimable GST); and it uses contract value rather than amounts actually invoiced. So the profit split runs on a figure that is neither actual nor comparable. | Profit is derived from project-tagged ledger lines (revenue − job costs), per the definition in DECISIONS.md. |
| A-09 | `project_pnl` view | Medium | GST is hard-coded as `* 0.08` when `projects.gst_amount` is 0. | Rates come from effective-dated settings. |
| A-10 | `project_profit_split` view | High | Three problems. (1) Financing sources of type `external_loan` are left out of the 20% pool weighting; only `investor` and `capital_pool` count. The spec says lenders share the pool. (2) The rounding remainder goes to the *largest* share, not to Company. (3) Percentages are rounded to 3 dp before pricing. | A split calculator in laari, per §5, with the worked example as a test. |
| A-11 | `project_profit_split` view | Medium | A person share is linked to a pool member by name prefix (`l.name ilike cm.name||'%'`). Renaming someone breaks the link silently. | Link by `contact_id`. |
| A-12 | `project_profit_split` / `profit_shares` | Medium | Nothing checks that scheme percentages total 100%, and schemes are not versioned. | `profit_schemes` with effective dates, plus a DB check on the total. |
| A-13 | `investor_balances` view, `investor_paid_marks` | Medium | A "paid" mark forces the owed amount to 0 whatever was actually repaid, which hides real balances. | Balances only from payouts posted against payables. |
| A-14 | `src/app/actions/project-status.ts:128-225` | High (for §6) | Profit shares settle in full as soon as *a* payment is recorded, whatever its amount. There are no partial payments and no check that the client balance is 0. | Payout release rule from §6: derived client balance = 0. |
| A-15 | `src/app/actions/project-status.ts:35, 137-139` | Medium | The date is not validated (`new Date("x")` throws a RangeError, which is unhandled). A malformed amount becomes `NaN` and is stored as `null`. | Validate with zod at every action boundary. |
| A-16 | `src/app/actions/project-status.ts:94-121` | Low | Undoing completion leaves `status = completed` and progress at 100%. It also skips the lock check that `markCompleted` has. | Status is derived in the rebuild. |
| A-17 | `src/lib/accounting.ts:112-126` (`loadRecords`) | High (latent) | Loads whole tables with no pagination. Supabase caps a select at 1,000 rows, so once there are more than 1,000 bills the statements and reports would silently leave rows out. | Aggregate in SQL or views from the ledger; paginate lists. |
| A-18 | Columns listed in §3 | Low | 14 money columns are unconstrained `numeric`. | `numeric(18,2)` (or integer laari) everywhere, per the ground rules. |
| A-19 | `src/lib/statements.ts`, `accounting.ts`, `audit-checks.ts`, and client components (`quotation-form.tsx`, `profit-share-card.tsx`, `investments-panel.tsx`, `repay-modal.tsx`, `financing-modal.tsx`) | Medium | Money math is done in JavaScript floats. Browser components compute totals and shares for display. | Posting and calculation in SQL/server with integer laari; the browser only formats. |
| A-20 | `invoices.status`, `bills.status` | High (for §1) | Statuses (`paid`, `part_paid`, `overdue`) are set by hand, so they can disagree with money received. The self-audit found 105 bills "paid" with no amount. | Status derived from payment applications. |
| A-21 | `bills` | Medium | No check that total = subtotal + tax, no uniqueness of vendor + bill number (a duplicate AH Brothers bill was found), and no check that amounts are ≥ 0. | Constraints in the new transaction tables; duplicate warning on entry. |
| A-22 | `src/app/actions/salaries.ts` | Medium | Salary is modelled as a withdrawal from a partner's pool balance. There is no gross/net, pension, WHT, payslip or project allocation. | Payroll module (§7). |
| A-23 | `src/app/actions/salaries.ts:160, 320`, `documents.ts:131, 274, 556, 585`, `bill-intake.ts:117, 193`, `books.ts:55, 118, 128` | Low | Secondary writes ignore their error result. | Check every result, or fold the writes into one RPC. |
| A-24 | `.env.example` | Low | Lists 2 of the 11 variables the app reads. | List them all, with comments. |
| A-25 | `src/middleware.ts` | Low | Next 16 build warning: the "middleware" file convention is deprecated in favour of "proxy". | Rename to `src/proxy.ts`, same logic. |
| A-26 | `package.json` | Low | `npm audit`: 2 moderate issues (the `uuid` dependency of `exceljs`). Deprecated transitive packages (glob, inflight, rimraf). | Monitor; `exceljs` has no fixed release yet. The risk is server-side only, low. |
| A-27 | `src/lib/extract-bill.ts:126` | Low | The model ID is hard-coded (`claude-opus-5`). | Move to an env var, like the Gemini models. |
| A-28 | Supabase Auth | Low | Leaked-password protection is disabled. | Enable it in Auth settings. |
| A-29 | Database | Low | `pg_trgm` is in `public`, and 30+ enums plus 2 tables (`funding_rounds`, `commitments`) are unused. | Move the extension; drop the unused objects once you approve. |
| A-30 | `internal_account_entries`, `capital_pool_entries`, `investor_repayments` | High (for §5) | The principal, pool return and fixed share of one person are not held as three separate balances. Pool earnings and retained shares are merged into one "pool" balance per member. | Separate payable sub-accounts per component (§5). |
| A-31 | Tables with no audit trigger: `budget_lines`, `milestones`, `project_profit_shares`, `capital_pool_contributions`, `salary_plans`, `profit_shares`, `company` | Medium | Changes to these are not in the change log, which is why their deleted rows cannot be recovered. | Audit trigger on every table that touches money or settings. |
| A-32 | Whole app | High | There are no automated tests for any money calculation. | Phase 3: engine tests, invariants, property tests, end-to-end tests. |

**Slow queries / N+1:** no per-row query loops were found in pages. The main cost is A-17: accounting pages load 13 whole tables and rebuild the journal in memory on every request. Bulk bill updates run 20 at a time (`audit.ts:48`), which is acceptable.

**Console and runtime errors:** no `console.*` calls or empty `catch` blocks in `src/`. I could not load pages in a browser as a signed-in user from this sandbox (it cannot reach Supabase), so console errors on live pages are **not verified**. That check moves to Phase 5 on a preview deployment.

## 7. Build and test results

| Step | Result |
|---|---|
| `npm ci` | OK. 8 deprecation warnings (eslint 9, fstream, glob 7, inflight, lodash.isequal, node-domexception, rimraf 2, uuid 8) |
| `tsc --noEmit` | 0 errors |
| `eslint .` | 0 errors, 0 warnings |
| `next build` | OK, 53 routes. 1 warning: the middleware → proxy deprecation |
| Tests | None exist |
| `npm audit --omit=dev` | 2 moderate (uuid via exceljs) |

## 8. Checked with sample data (28 Sep 2026)

I ran sample projects through the **current** database logic (`project_pnl` and `project_profit_split` views, RLS). It all ran inside one transaction that was rolled back, and afterwards the live data was confirmed unchanged: 0 projects, 2 clients, 279 change-log rows, no test user.

### Test 1 — the §5 worked example

The setup: contract 800,000, and one bill of 277,777.78 + 8% GST 22,222.22 = 300,000. Financing was 400,000 from an external lender and 600,000 from the Capital Pool (Mujahid 300k, Muaz 200k, Mushahid 100k).

| Share | Spec expects | Current app gives | |
|---|---|---|---|
| Project profit | 500,000 (per the spec's example) | 500,000 | Only because the bill **total including claimable GST** was subtracted (A-08). With the GST treated as input tax, profit would be 522,222.22 |
| External lender, pool 20% | 40,000 | **0** | Lenders are left out of the pool (A-10) |
| Mujahid, pool | 30,000 | **50,000** | Pool members take the lender's share |
| Muaz, pool | 20,000 | **33,335** | Also rounded: the percentage is cut to 3 dp (6.667%) |
| Mushahid, pool | 10,000 | **16,665** | |
| Mujahid 25% / Muaz 10% / Mushahid 10% / Mariyam 5% | 125,000 / 50,000 / 50,000 / 25,000 | same | ✓ |
| Company 30% | 150,000 | 150,000 | ✓ |
| GST shown on the project | from settings | 64,000 (hard-coded 8% of contract) | A-09 |

**Result: A-08, A-09 and A-10 are confirmed.** Whenever an external lender is involved, the current split overpays Capital Pool members and pays the lender nothing.

### Test 2 — rounding

The setup: profit 100,000.07, Capital Pool only, in thirds (33.333 / 33.333 / 33.334).

- Each member is priced at 6.667% of profit, giving 6,667.00. The correct share is 6,666.67.
- So members are overpaid 0.99 in total, and Company absorbs the difference: 29,999.03 instead of 30,000.02.
- The total still adds up (100,000.07), but individual shares are wrong. **A-10 (3-dp rounding) is confirmed.**

### Test 3 — a loss

The setup: contract 100,000, costs 150,000, no financing.

- Every fixed share goes **negative**: Company −25,000 (it absorbs the unused 20% pool), Mujahid −12,500, Muaz −5,000, Mushahid −5,000, Mariyam −2,500.
- On completion these would be booked as negative amounts owed. The spec leaves loss behaviour to DECISIONS.md, so this is Phase 1 question P2.

### Test 4 — what a `viewer` user can read

A test viewer account (created and rolled back) could read:

| Table | Rows readable |
|---|---|
| people | 4 |
| capital pool members | 5 |
| profit shares | 6 |
| financing sources | 3 |
| bills | 2 |
| change log | 0 (correctly blocked) |

**A-06 is confirmed:** payroll and partner data is readable by any signed-in user.

### Not verifiable from this sandbox

- **A-17 (1,000-row cap):** needs the REST API, which the sandbox cannot reach. It is standard Supabase behaviour and will be covered by a test in Phase 3.
- **Console errors on live pages:** moves to Phase 5.
