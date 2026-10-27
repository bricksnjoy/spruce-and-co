#!/usr/bin/env bash
# Apply to the live Supabase database every db/migrations/*.up.sql it does not
# have yet, in order. Run by .github/workflows/db-migrate.yml with the
# SUPABASE_DB_URL secret. Each migration runs in one transaction together with
# its record in migration_log.applied, so a failed migration changes nothing
# and is tried again on the next run.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the live database connection string}"
psql_() { psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q "$@"; }

# What Live already had when this runner took over (27 Oct 2026); 034 had not been applied.
ALREADY_LIVE="001_settings_rates 002_accounts 003_contacts 004_employees 005_ledger_core 006_project_value
007_payroll 008_gst 009_financing 012_health 013_security 014_hardening 015_settings_screens 016_contacts
017_customers_are_clients 018_projects 019_sales 020_advances 021_expenses 022_payroll_screens 023_banking
024_taxes 025_financing_screens 026_reports 027_safeupdate 028_cut_lists 029_bids 030_company_capital
031_one_book 032_invoice_layout 033_pool_counts_undeposited 035_company_return 036_stage_gst"

psql_ <<'SQL'
set client_min_messages = warning;
create schema if not exists migration_log;
revoke all on schema migration_log from public, anon, authenticated;
create table if not exists migration_log.applied (
  name text primary key,
  applied_at timestamptz not null default now(),
  source text not null default 'github-action'
);
SQL

if [ "$(psql_ -tA -c 'select count(*) from migration_log.applied')" = "0" ]; then
  for n in $ALREADY_LIVE; do
    psql_ -c "insert into migration_log.applied (name, source) values ('$n', 'already-live')"
  done
  echo "Recorded the migrations Live already had"
fi

applied=0
for f in $(ls db/migrations/*.up.sql | sort); do
  name=$(basename "$f" .up.sql)
  [[ "$name" =~ ^[0-9]{3}_[a-z0-9_]+$ ]] || { echo "Unexpected migration name: $name" >&2; exit 1; }
  if [ "$(psql_ -tA -c "select count(*) from migration_log.applied where name = '$name'")" = "0" ]; then
    echo "Applying $name"
    psql_ --single-transaction -f "$f" \
      -c "insert into migration_log.applied (name) values ('$name')" \
      -c "insert into supabase_migrations.schema_migrations (version, name) values (to_char(clock_timestamp() at time zone 'utc', 'YYYYMMDDHH24MISS'), '$name')"
    applied=$((applied + 1))
  fi
done
echo "Live database is up to date ($applied applied)"
