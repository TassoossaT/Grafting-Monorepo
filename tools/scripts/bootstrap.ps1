<#
.SYNOPSIS
    One-time (idempotent) workspace bootstrap for Grafting Monorepo.

.DESCRIPTION
    Installs/syncs all four ecosystems once, per master source S8.4's
    "bootstrap once, then run tasks in parallel with --no-sync/--frozen"
    pattern. Safe to re-run: every step here is idempotent.

    Does not touch the .NET ecosystem yet (no root .NET scaffolding exists
    -- see CURRENT_PLANNING_STATE.md).
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $RepoRoot

Write-Host "==> pnpm install (frozen lockfile)" -ForegroundColor Cyan
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

Write-Host "==> cargo check --workspace" -ForegroundColor Cyan
cargo check --workspace
if ($LASTEXITCODE -ne 0) { throw "cargo check --workspace failed" }

Write-Host "==> uv sync --locked" -ForegroundColor Cyan
uv sync --locked
if ($LASTEXITCODE -ne 0) { throw "uv sync --locked failed" }

Write-Host "==> Bootstrap complete." -ForegroundColor Green
