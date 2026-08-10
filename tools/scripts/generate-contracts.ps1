<#
.SYNOPSIS
    Regenerates Rust/TS/C# from libs/engine/domain-core/contracts/*.fbs
    (master source S10.3 -- deterministic, run via the Nx
    `engine-domain-core:generate` target, not by hand).

.DESCRIPTION
    Rust and TS use the primary pinned `flatc` (tools/flatc-version.txt)
    from PATH. C# uses a second, older, equally-pinned `flatc`
    (tools/scripts/get-flatc-csharp.ps1) -- the published
    Google.FlatBuffers NuGet package lags the primary pin; see that
    script's own header for why this is the real fix, not a workaround.
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $RepoRoot

$schemas = @(
    "libs/engine/domain-core/contracts/command.fbs",
    "libs/engine/domain-core/contracts/domain_event.fbs",
    "libs/engine/domain-core/contracts/snapshot.fbs",
    "libs/engine/domain-core/contracts/map_state.fbs"
)


Write-Host "==> flatc --rust" -ForegroundColor Cyan
flatc --rust -o libs/engine/domain-core/src/generated @schemas
if ($LASTEXITCODE -ne 0) { throw "flatc --rust failed" }

Write-Host "==> flatc --ts" -ForegroundColor Cyan
flatc --ts -o packages/isekai-web-client/src/generated @schemas
if ($LASTEXITCODE -ne 0) { throw "flatc --ts failed" }

Write-Host "==> flatc --csharp (version-matched to Google.FlatBuffers on NuGet)" -ForegroundColor Cyan
$csharpFlatc = & (Join-Path $PSScriptRoot "get-flatc-csharp.ps1") | Select-Object -Last 1
& $csharpFlatc --csharp -o "dotnet/Grafting.Isekai.Protocol/Generated" @schemas
if ($LASTEXITCODE -ne 0) { throw "flatc --csharp failed" }

Write-Host "==> Contracts generated." -ForegroundColor Green
