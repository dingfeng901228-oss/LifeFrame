# infra/migrate.ps1 — apply all infra/*.sql files in lex order against $env:SUPABASE_DB_URL
#
# Usage (PowerShell on Windows):
#   $env:SUPABASE_DB_URL = 'postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres'
#   pwsh infra/migrate.ps1
#
# For bash / zsh / Git Bash on Windows / WSL, use infra/migrate.sh.
#
# Get SUPABASE_DB_URL from:
#   Supabase Dashboard → Project Settings (gear icon) → Database →
#   Connection string → "URI" tab → copy.
#
# Idempotent: every .sql file in this folder uses CREATE TABLE IF NOT EXISTS /
# CREATE INDEX IF NOT EXISTS where possible, so re-running on a DB that
# already has the schema is a no-op.

$ErrorActionPreference = 'Stop'

if (-not $env:SUPABASE_DB_URL) {
  Write-Host "✗ SUPABASE_DB_URL env var not set." -ForegroundColor Red
  Write-Host "  Get it from: Supabase Dashboard → Project Settings → Database" -ForegroundColor Red
  Write-Host "  → Connection string → URI tab → copy." -ForegroundColor Red
  Write-Host ""
  Write-Host "  Then re-run with:"
  Write-Host '    $env:SUPABASE_DB_URL = ''postgresql://...'''
  Write-Host "    pwsh infra/migrate.ps1"
  exit 1
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Host "✗ psql not found in PATH." -ForegroundColor Red
  Write-Host "  Install PostgreSQL client tools first:"
  Write-Host "    EDB installer: https://www.enterprisedb.com/download-postgresql-binaries"
  Write-Host "    choco install postgresql"
  Write-Host "    winget install PostgreSQL.PostgreSQL"
  exit 1
}

# Resolve script dir so this works from any cwd.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$SqlFiles = Get-ChildItem -Path $ScriptDir -Filter '*.sql' | Sort-Object Name

if ($SqlFiles.Count -eq 0) {
  Write-Host "✗ No .sql files found in $ScriptDir" -ForegroundColor Red
  exit 1
}

# Sanity: redact password before echoing the URL.
$RedactedUrl = [regex]::Replace($env:SUPABASE_DB_URL, '://[^:]+:[^@]+@', '://USER:PASS@')
Write-Host "▶ $($SqlFiles.Count) migration(s) to apply against $RedactedUrl"
Write-Host ""

$Failed = 0
foreach ($File in $SqlFiles) {
  Write-Host "  ▶ $($File.Name)"
  # ON_ERROR_STOP=1 makes psql exit non-zero on the first failed statement
  # (without it psql keeps going and the last statement's status hides
  # earlier errors). -q suppresses per-statement chatter.
  $Output = & psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -f $File.FullName -q 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Host "    ✓ ok"
  } else {
    Write-Host "    ✗ FAILED — re-running with full output for debugging:" -ForegroundColor Red
    Write-Host ""
    & psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -f $File.FullName 2>&1 | Write-Host
    Write-Host ""
    $Failed++
  }
}

Write-Host ""
if ($Failed -gt 0) {
  Write-Host "✗ $Failed migration(s) failed. Fix the SQL above and re-run." -ForegroundColor Red
  exit 1
}

Write-Host "✓ All migrations applied." -ForegroundColor Green
Write-Host ""
Write-Host "  PostgREST usually picks up new tables within ~30s. If API requests"
Write-Host "  still complain about 'Could not find the table X in the schema cache',"
Write-Host "  force a refresh in Supabase Dashboard → SQL Editor:"
Write-Host ""
Write-Host "      NOTIFY pgrst, 'reload schema';"
Write-Host ""
