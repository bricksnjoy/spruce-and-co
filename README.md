# Spruce & Co — Back Office

Back-office system for Spruce & Co, a construction company that delivers projects and
raises investment against them.

Next.js 15 (App Router) · TypeScript · Tailwind · Supabase (Postgres, Auth, Storage) · Vercel.

## What's in it

**Core** — Dashboard, Projects, Tasks & calendar, Project P&L
**Pre-construction** — Leads/clients, Estimates & BOQ, Tenders, Quotations, Contracts
**Site operations** — Site diaries, Progress tracking, Inspections & snags, Safety, Documents, RFIs & variations
**Procurement** — Suppliers & subcontractors, Purchase orders & requests, Material requests, Inventory, Equipment
**People** — Employees & labour, Attendance & timesheets, Payroll, Work permits & visas, Crews
**Capital** — Investors, Funding rounds, commitments, drawdowns, distributions
**Finance** — Invoices, Payments, Bills & costs, Bill scanning, Expenses, Retention, Budgets
**Admin** — Reports, Users & roles, Settings

### Project P&L

Each project carries: value, approved variations, GST, EXP (all expenditure —
supplier bills, approved expenses, payroll charged to the job), and profit:

```
profit = (value + variation) − GST − EXP
```

Alongside it sits the project's investment person, how much they put in, and their
share — either a percentage of profit (e.g. 40%) or a fixed amount — plus what that
share works out to and what Spruce & Co keeps.

### Bill scanning

Upload a photo, scan or PDF of a bill. It's read automatically — shop name, product
lines, amounts, tax and date — then held for review. Nothing posts to the ledger until
you confirm, every field is editable before confirming, and it stays editable
afterwards: corrections flow through to the bill that was created.

Auto-reading needs `ANTHROPIC_API_KEY`. Without it, upload and manual entry work
exactly the same; only the automatic reading is skipped.

## Roles

Enforced by row-level security in Postgres, not just hidden in the sidebar.

| Role | Can do |
|---|---|
| `admin` | Everything, including deletes, users and company settings |
| `manager` | Create/edit across projects, site, procurement, people. No payroll or permits |
| `finance` | Create/edit finance, procurement, capital. Sees payroll and permits. No site diaries |
| `viewer` | Read-only |

The first account to sign up becomes `admin`; everyone after lands as `viewer` for an
admin to promote.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the two Supabase values
npm run dev
```

Environment variables:

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase publishable key |
| `ANTHROPIC_API_KEY` | no | Enables automatic bill reading |
| `TELEGRAM_BOT_TOKEN` | no | Bot token from @BotFather; with `TELEGRAM_CHAT_ID`, bid updates are posted to the company group |
| `TELEGRAM_CHAT_ID` | no | The Telegram group's id (starts with `-100`) |

## Database

Schema lives in Supabase migrations — around 50 tables plus reporting views
(`project_pnl`, `project_financials`, `project_profitability`, `investor_positions`,
`cash_summary`, `permit_alerts`, `low_stock_items`). Two private storage buckets:
`documents` and `bills`.

Row-level security is on for every table. Payroll, payslips and work permits are
restricted to `admin` and `finance`.

## Moving to a VPS later

Nothing here is tied to Vercel. It's a standard Next.js app — `npm run build && npm start`
behind a reverse proxy works. Supabase can stay hosted or be self-hosted; only the two
`NEXT_PUBLIC_SUPABASE_*` values change.
