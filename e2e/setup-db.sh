#!/usr/bin/env bash
# Stand up the throwaway local Supabase database for the browser tests:
# production's baseline schema (without the test harness's auth stub — the real
# Supabase auth is used here), every migration in order, and a seed with one
# user per role. Never points at the live project.
set -euo pipefail
cd "$(dirname "$0")/.."
DB_URL="${E2E_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB_URL" in *127.0.0.1*|*localhost*) ;; *) echo "Refusing: E2E_DB_URL must be a local database" >&2; exit 1 ;; esac
psql_() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }

psql_ -c "drop schema if exists public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres, service_role;"
# the baseline without its auth stub (Supabase has the real auth schema)
sed '/^-- Supabase auth, reduced/,/^\$\$;$/d' db/baseline/existing.sql | psql_
for f in $(ls db/migrations/*.up.sql | sort); do psql_ -f "$f"; done
psql_ -f e2e/seed.sql
echo "e2e database ready"
