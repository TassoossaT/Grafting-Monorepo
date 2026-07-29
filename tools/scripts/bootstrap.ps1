<#
.SYNOPSIS
    One-time (idempotent) workspace bootstrap for Grafting Monorepo.

.DESCRIPTION
    Installs/syncs all four ecosystems once, per master source S8.4's
    "bootstrap once, then run tasks in parallel with --no-sync/--frozen"
    pattern. Safe to re-run: every step here is idempotent.
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

Write-Host "==> dotnet restore --locked-mode" -ForegroundColor Cyan
dotnet restore System.sln --locked-mode
if ($LASTEXITCODE -ne 0) { throw "dotnet restore --locked-mode failed" }

Write-Host "==> flatc version check" -ForegroundColor Cyan
# flatc has no auto-read pin file the way rustup/dotnet have
# rust-toolchain.toml/global.json -- tools/flatc-version.txt is this
# repo's own equivalent (master source S10.3: "have a pinned version").
# Not auto-installed here (unlike pnpm/cargo/uv/dotnet's own packages) --
# install via `winget install --id Google.flatbuffers --exact` (Windows)
# or the matching platform binary from the flatbuffers GitHub releases
# (CI/Linux), then re-run bootstrap.
$flatcPinned = (Get-Content (Join-Path $PSScriptRoot "../flatc-version.txt")).Trim()
$flatcCmd = Get-Command flatc -ErrorAction SilentlyContinue
if (-not $flatcCmd) {
    throw "flatc not found on PATH. Install version $flatcPinned (see tools/flatc-version.txt) and re-run bootstrap."
}
$flatcVersionOutput = & flatc --version
if ($flatcVersionOutput -notmatch [regex]::Escape($flatcPinned)) {
    throw "flatc version mismatch: found '$flatcVersionOutput', expected $flatcPinned (see tools/flatc-version.txt)."
}
Write-Host "    flatc $flatcPinned found." -ForegroundColor DarkGray

Write-Host "==> Bootstrap complete." -ForegroundColor Green
