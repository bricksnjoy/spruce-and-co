# Decisions

Your answers to the Phase 1 questions. On 28 Sep 2026 you replied **"defaults OK"**, so every suggested default below is now the decision (✅). Items that still need a figure or fact from you before they are used are marked 📝; they are built as settings, so supplying them later needs no code change.

## Approvals

| Date | Phase | Decision |
|---|---|---|
| 28 Sep 2026 | Phase 0 (audit) | ✅ Approved: "check using sample data, and approve for next phase". The sample-data check is in AUDIT.md §8 |
| 28 Sep 2026 | Phase 2 (architecture) | ✅ "continue with 3": plan approved; Phase 3 started. Test database (Q2) and browser-test CI (Q3) are decided at Phase 4 |
| 28 Sep 2026 | Data | ✅ The records deleted on 27 Sep were **test data**. Nothing is imported from the change log; the ledger starts clean, with real opening balances at 1 Jan 2026 |
| 28 Sep 2026 | Reference data (R1) | ✅ **Real:** the 4 people, 5 capital-pool members and 4 signatories. **Not confirmed:** 39 vendors, 2 clients, 2 investors. They will be migrated marked "check", so nothing is lost and you can archive test entries |
| 28 Sep 2026 | Phase 1 (questions and features) | ✅ "defaults OK": all suggested defaults and ★ feature picks accepted |

---

## A. Raised by the audit

| # | Question | Suggested default | Answer |
|---|---|---|---|
| A1 | Most 2026 transactions were deleted on 27 Sep; the change log holds them. Rebuild opening balances from them, or re-enter them as documents? | — | ✅ **Neither: it was test data.** It is not imported. (Supersedes the default.) |
| A2 | Opening-balance / go-live date? | **1 January 2026** (the full 2026 year, so the first year-end has clean comparatives) | ✅ |
| A3 | Add **Vitest** as a dev dependency for the Phase 3 tests? It is not a stack change | Yes | ✅ |
| A4 | Where does posting logic live? | **Postgres functions**: one transaction per document, and debits = credits enforced by a deferred trigger. Calculators (split, payroll, GST) are server-side TypeScript, tested, and called by those functions' callers; nothing runs in the browser | ✅ |
| A5 | There is only one Supabase database, and production uses it. Where do new ledger tables go while we build? | **New tables beside the old ones** (non-destructive). The old screens keep working until cut-over; production keeps deploying from the current branch until you sign off | ✅ |
| A6 | Your 2 "investors": external lenders, or something else? | **External lenders** (one Project Loans sub-account each) | ✅ |
| A7 | Keep the cabinet estimator, Message Center, Tasks & Calendar and Shops as they are? | Yes, keep them. Shops becomes the vendor directory view | ✅ |
| A8 | Remove the project hard-delete button now (it caused the bill loss), before the rebuild lands? | Yes: replace it with Archive in the current app now | ✅ |
| A9 | Drop unused tables (`funding_rounds`, `commitments`) and 30+ dead enums after cut-over? | Yes, after cut-over, with your final OK | ✅ |

## B. Profit and financing (§15 Q1–7)

| # | Question | Suggested default | Answer |
|---|---|---|---|
| P1 | Project profit: direct costs only, or with an overhead allocation? | **Direct costs only**: revenue minus job costs, including site labour and non-claimable GST | ✅ |
| P2 | If a project makes a loss, who bears it? Is principal at risk? Fixed shares zero or negative? | **Shares are zero on a loss; the company bears it; principal is repaid in full.** Today's app would book *negative* shares (see AUDIT §8, Test 3) | ✅ |
| P3 | Principal repaid under the same release rule as payouts, or earlier? | **Same rule**: only once the client balance is 0 | ✅ |
| P4 | Contribution ratio: amount only, or amount × time? | **Amount only** | ✅ |
| P5 | External lenders: only their share of the 20% pool, or interest too? | **Pool share only** | ✅ |
| P6 | Which scheme applies to a project: the one active at start, or at completion? Were there projects under an old "Investor Split" model? | **At project start**. Old model: please describe it, or say none | ✅ at project start · 📝 no old model assumed; tell me if one existed |
| P7 | Fixed profit shares posted as an expense or as dividends? | **Setting**, defaulting to **Profit Share expense** until the auditor confirms | ✅ |

## C. Payroll (§15 Q8–17)

| # | Question | Suggested default | Answer |
|---|---|---|---|
| Y1 | Pay cycle and pay day? | **Monthly, paid on the last working day** | ✅ |
| Y2 | How many staff: Maldivian vs expatriate, site vs admin? | Please tell me; it sizes the forms, not the design | 📝 headcount still needed; the design does not depend on it |
| Y3 | Pension rates and who they apply to? | **Maldivian staff only: 7% employee + 7% employer**, entered as effective-dated settings. **Please confirm against the current MRPS rules** | ✅ 7% + 7% Maldivians · 📝 confirm the rates before the first payroll run |
| Y4 | Do we withhold income tax from salaries? Which brackets? | **Yes: employee withholding tax with MIRA's brackets entered as a dated table.** Please confirm the brackets and thresholds you use | ✅ withhold · 📝 brackets to be entered in Settings before the first payroll run |
| Y5 | Which allowances? Overtime rules? | **Island/site, living, transport, phone**; overtime at an hourly rate × a multiplier set per employee | ✅ |
| Y6 | Site labour to projects: timesheets or fixed %? | **Fixed % per employee per month** (timesheets as an optional feature) | ✅ |
| Y7 | Salary advances? How recovered? | **Yes**, recovered in equal instalments over months you choose | ✅ |
| Y8 | Directors paid through payroll? | **Yes**, as admin staff | ✅ |
| Y9 | Expatriate costs (permits, insurance, accommodation, food) allocated to projects? | **Yes, by the same % as the employee's labour** | ✅ |
| Y10 | Who can see payroll? | **admin and finance only** (enforced in pages and the database) | ✅ |

## D. GST (§15 Q18–22)

| # | Question | Suggested default | Answer |
|---|---|---|---|
| G1 | Rates and tax codes? | **Standard 8%** (dated, since it was 6% before 2023), **zero-rated 0%, exempt, out of scope** | ✅ |
| G2 | Quarterly filing; filing and payment due day? | **Quarterly, due the 28th of the month after the quarter**, as a setting. Please confirm with MIRA | ✅ quarterly, 28th · 📝 due day is a setting |
| G3 | Input more than output: carry forward or refund? | **Carry forward** | ✅ |
| G4 | A bill dated in an already-filed quarter: block, or adjust next return? | **Allow it, and include it in the next open return as an adjustment**, flagged | ✅ |
| G5 | Do we pay GST at customs on imports? Evidence? | **Yes**: the customs declaration number plus a copy of the declaration | ✅ |

## E. Billing (§15 Q23–25)

| # | Question | Suggested default | Answer |
|---|---|---|---|
| B1 | Do clients withhold retention? What % and release terms? From subcontractors? | **Off for now** (setting available: % per project, released on handover or after the defects period) | ✅ |
| B2 | Mobilisation advances from clients? | **Yes**: held as Customer Advances and applied to invoices | ✅ |
| B3 | Currencies besides MVR? | **USD** (suppliers abroad, some clients) | ✅ |

## F. Financial statements (§15 Q26–28)

| # | Question | Suggested default | Answer |
|---|---|---|---|
| F1 | IFRS or IFRS for SMEs? | **IFRS for SMEs** | ✅ |
| F2 | Revenue: billing basis or percentage of completion? | **Billing basis**, with POC available as a setting | ✅ |
| F3 | BPT provision: calculated or manual? Fiscal year? Comparatives? | **Calculated from settings (15% above MVR 500,000), editable before posting; calendar year; one prior year** | ✅ |

## G. Setup and access (§15 Q29–32)

| # | Question | Suggested default | Answer |
|---|---|---|---|
| S1 | Who uses the system, with which roles? Partners/investors log in for their own statements? | **admin, finance, manager, viewer** as today, plus a **payroll permission**. No partner login for now | ✅ |
| S2 | Banks and their statement export formats? | **BML (CSV)** first; others once we have a sample file | ✅ |
| S3 | Migrate data or start fresh? | **Fresh, with opening balances** | ✅ Fresh, with real opening balances at 1 Jan 2026 entered or imported by you; reference data migrated (see question R1 in ARCHITECTURE §9) |
| S4 | Document numbering and invoice design? | **Keep today's**: `SC-Q/{YY}/nn`, `SC-INV/{YY}/nn`, and the current template editor and design; add `SC-BILL`, `SC-PAY`, `SC-JE` | ✅ |

---

## H. Feature menu (§16)

Choose **include**, **skip**, or **include with changes**. ★ = I recommend it.

| Feature | How it would work here | Rec. | Choice |
|---|---|---|---|
| Purchase orders | Raise a PO to a supplier against a project and budget category. Open POs show as committed cost in Project Value, and a bill can be matched to its PO | ★ | ✅ include |
| Materials inventory / stock on site | Receive materials into a site or store, and issue them to projects; the cost moves when issued. Heavy to keep accurate for a small team | skip for now | ✅ skip |
| Fixed asset register + depreciation | Today's equipment register, upgraded: each asset posts monthly depreciation to the ledger automatically, and disposals post gain/loss | ★ | ✅ include |
| Timesheets | Daily site attendance per employee per project, used to split labour cost instead of fixed % | later | ✅ later (not in this build) |
| Employee self-service | Staff log in and download their own payslips | skip | ✅ skip |
| Recurring transactions | Templates for rent, utilities, subscriptions and monthly journals, created on a schedule for review | ★ | ✅ include |
| Email invoices and payment reminders | Send the tax-invoice PDF from the invoice page; automatic reminders at 7/14/30 days overdue through the existing Message Center (email/SMS) | ★ | ✅ include |
| Bank rules and auto-matching | Rules like "description contains DHIRAAGU → Utilities". Imported lines matched automatically to open payments by amount and date | ★ | ✅ include |
| Multicurrency revaluation | USD bank and USD balances revalued at month end at the MMA rate, posting FX gain/loss | ★ if B3 = USD | ✅ include |
| Receipt scanning | Today's bill OCR/AI capture, kept and wired into the new bill form (fills supplier, TIN, tax invoice number and lines) | ★ | ✅ include |
| Approval workflows | Bills over a set amount, payroll runs and payouts need MD approval before posting or paying | ★ | ✅ include |
| Client portal | Clients view and download their invoices and statement online | skip | ✅ skip |
| Partner/investor portal | Partners log in to see their own statement (principal, returns, profit share) | later | ✅ later (not in this build) |
| Import from QuickBooks or Excel | Excel templates to import contacts, opening balances and the chart of accounts | ★ (for go-live) | ✅ include |

**Extra ideas for a construction company** (not in §16):

| Feature | How it would work here | Rec. | Choice |
|---|---|---|---|
| Progress billing schedule | Set a project's billing stages once (e.g. 30% mobilisation, 40% at structure, 30% at handover); each stage becomes a ready-to-send invoice | ★ | ✅ include |
| Subcontractor compliance | Warn when paying a subcontractor whose licence or insurance has expired (the fields already exist on vendors) | ★ | ✅ include |
| Budget alerts | Flag a project when a cost category passes 80% / 100% of its budget | ★ | ✅ include |
| Tags (site / island) | Tag transactions by island or site for reporting across projects | later | ✅ later (not in this build) |
| Cash-flow forecast | 12-week view of expected client receipts (billing stages) against bills, payroll and payouts due | ★ | ✅ include |
| Document inbox | Forward supplier invoices to an email address; they land as draft bills | later | ✅ later (not in this build) |
