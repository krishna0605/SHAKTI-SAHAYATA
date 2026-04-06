# ============================================================
# SHAKTI — Local PostgreSQL Setup (Non-Docker Fallback)
# Run this if NOT using Docker for the database
# Requires: PostgreSQL 15+ installed and psql in PATH
# ============================================================

$ErrorActionPreference = "Stop"

$DB_NAME = if ($env:DB_NAME) { $env:DB_NAME } else { "shakti_db" }
$DB_USER = if ($env:DB_USER) { $env:DB_USER } else { "shakti_admin" }
$DB_PASSWORD = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "localdevpassword" }
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  SHAKTI — Local Database Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if psql is available
try {
    $psqlVersion = & psql --version 2>&1
    Write-Host "[OK] PostgreSQL found: $psqlVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] psql not found in PATH. Please install PostgreSQL 15+ first." -ForegroundColor Red
    Write-Host "Download: https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
    exit 1
}

# Create role if not exists
Write-Host "[1/4] Creating database user '$DB_USER'..." -ForegroundColor Yellow
$createRole = "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD' CREATEDB; END IF; END `$`$;"
& psql -U postgres -c $createRole 2>$null
Write-Host "  -> User ready" -ForegroundColor Green

# Create database if not exists
Write-Host "[2/4] Creating database '$DB_NAME'..." -ForegroundColor Yellow
& psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | Out-Null
$dbExists = & psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" 2>$null
if ($dbExists -notmatch "1") {
    & psql -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
    Write-Host "  -> Database created" -ForegroundColor Green
} else {
    Write-Host "  -> Database already exists" -ForegroundColor Green
}

# Run schema
Write-Host "[3/4] Running schema.sql..." -ForegroundColor Yellow
& psql -U $DB_USER -d $DB_NAME -f "$SCRIPT_DIR\schema.sql"
Write-Host "  -> Schema applied" -ForegroundColor Green

# Run seed
Write-Host "[4/4] Running seed.sql..." -ForegroundColor Yellow
& psql -U $DB_USER -d $DB_NAME -f "$SCRIPT_DIR\seed.sql"
Write-Host "  -> Seed data loaded" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  Connection: postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}" -ForegroundColor White
Write-Host "============================================" -ForegroundColor Cyan
