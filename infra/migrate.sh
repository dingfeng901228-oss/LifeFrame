#!/usr/bin/env bash
# infra/migrate.sh — apply all infra/*.sql files in lex order against $SUPABASE_DB_URL
#
# Usage (bash / zsh / Git Bash on Windows / WSL):
#   export SUPABASE_DB_URL='postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres'
#   bash infra/migrate.sh
#
# For native PowerShell on Windows, use infra/migrate.ps1 instead.
#
# Get SUPABASE_DB_URL from:
#   Supabase Dashboard → Project Settings (gear icon) → Database →
#   Connection string → "URI" tab → copy.
#
# Idempotent: every .sql file in this folder uses CREATE TABLE IF NOT EXISTS /
# CREATE INDEX IF NOT EXISTS / CREATE POLICY IF NOT EXISTS-style guards where
# possible, so re-running on a DB that already has the schema is a no-op.
# (A few policies can't use IF NOT EXISTS — they `DROP POLICY IF EXISTS` first
# so the script is safe to re-apply after edits.)
#
# Requires:
#   - psql in PATH (PostgreSQL client). On Mac: `brew install libpq`.
#     On Linux: `apt install postgresql-client`. On Windows: EDB installer
#     (https://www.enterprisedb.com/download-postgresql-binaries) or Git Bash
#     from a Postgres install.

set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "✗ SUPABASE_DB_URL env var not set." >&2
  echo "  Get it from: Supabase Dashboard → Project Settings → Database" >&2
  echo "  → Connection string → URI tab → copy." >&2
  echo "" >&2
  echo "  Then re-run with:" >&2
  echo "    export SUPABASE_DB_URL='postgresql://...'" >&2
  echo "    bash infra/migrate.sh" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "✗ psql not found in PATH." >&2
  echo "  Install PostgreSQL client tools first:" >&2
  echo "    macOS:   brew install libpq && export PATH=\"\$(brew --prefix libpq)/bin:\$PATH\"" >&2
  echo "    Linux:   apt install postgresql-client  (or equivalent)" >&2
  echo "    Windows: EDB installer or 'choco install postgresql'" >&2
  exit 1
fi

# Resolve script dir + repo root so this works from any cwd.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

shopt -s nullglob
sql_files=( "$SCRIPT_DIR"/*.sql )
shopt -u nullglob

if [[ ${#sql_files[@]} -eq 0 ]]; then
  echo "✗ No .sql files found in $SCRIPT_DIR" >&2
  exit 1
fi

# Sanity: redact password before echoing the URL.
redacted_url="$(echo "$SUPABASE_DB_URL" | sed -E 's#://[^:]+:[^@]+@#://USER:PASS@#')"
echo "▶ ${#sql_files[@]} migration(s) to apply against $redacted_url"
echo ""

failed=0
for f in "${sql_files[@]}"; do
  base="$(basename "$f")"
  printf "  ▶ %s\n" "$base"
  # ON_ERROR_STOP=1 makes psql exit non-zero on the first failed statement
  # (without it psql keeps going and the last statement's status hides earlier
  # errors). -q suppresses the per-statement chatter so the script log stays
  # readable.
  if psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f" -q >/dev/null 2>&1; then
    echo "    ✓ ok"
  else
    echo "    ✗ FAILED — re-running with full output for debugging:" >&2
    echo "" >&2
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f" 2>&1 || true
    echo "" >&2
    failed=$((failed + 1))
  fi
done

echo ""
if [[ $failed -gt 0 ]]; then
  echo "✗ $failed migration(s) failed. Fix the SQL above and re-run." >&2
  exit 1
fi

echo "✓ All migrations applied."
echo ""
echo "  PostgREST usually picks up new tables within ~30s. If API requests"
echo "  still complain about 'Could not find the table X in the schema cache',"
echo "  force a refresh in Supabase Dashboard → SQL Editor:"
echo ""
echo "      NOTIFY pgrst, 'reload schema';"
echo ""
