[CmdletBinding()]
param(
    [switch]$SkipWorkspaceChecks
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

function Invoke-Checked {
    param(
        [Parameter(Mandatory)] [string]$Label,
        [Parameter(Mandatory)] [scriptblock]$Command
    )

    Write-Host "== $Label =="
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

function Resolve-Uv {
    $candidate = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\astral-sh.uv_*\uv.exe" `
        -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) {
        return $candidate.FullName
    }

    $command = Get-Command uv.exe -ErrorAction SilentlyContinue
    if ($command -and (Test-Path -LiteralPath $command.Source)) {
        return $command.Source
    }
    throw 'uv.exe not found'
}

function Resolve-Flatc {
    $command = Get-Command flatc -ErrorAction SilentlyContinue
    if ($command -and (Test-Path -LiteralPath $command.Source)) {
        return $command.Source
    }

    $candidate = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Google.flatbuffers_*\flatc.exe" `
        -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) {
        return $candidate.FullName
    }
    return $null
}

$uv = Resolve-Uv
$flatcExpected = (Get-Content -Raw tools/flatc-version.txt).Trim()
$uvExpected = (Get-Content -Raw tools/uv-version.txt).Trim()
$wasmPackExpected = (Get-Content -Raw tools/wasm-pack-version.txt).Trim()
$nodeExpected = (Get-Content -Raw .node-version).Trim()
$globalJson = Get-Content -Raw global.json | ConvertFrom-Json
$packageJson = Get-Content -Raw package.json | ConvertFrom-Json
$rustChannel = ((Get-Content -Raw rust-toolchain.toml) -split "`n" |
    Where-Object { $_ -match '^channel\s*=' }) -replace '.*"([^\"]+)".*', '$1'

Invoke-Checked 'git' { git --version }
Invoke-Checked 'node' { node --version }
Invoke-Checked 'pnpm' { pnpm.cmd --version }
Invoke-Checked 'cargo' { cargo --version }
Invoke-Checked 'rustc' { rustc --version }
Invoke-Checked 'uv' { & $uv --version }
Invoke-Checked 'python' { & .\.venv\Scripts\python.exe --version }
Invoke-Checked 'dotnet' { dotnet --version }
Invoke-Checked 'wasm-pack' { wasm-pack --version }

$actualNode = (& node --version).TrimStart('v')
if ($actualNode -ne $nodeExpected) { throw "node $actualNode != pin $nodeExpected" }

$actualPnpm = (& pnpm.cmd --version).Trim()
$expectedPnpm = $packageJson.packageManager -replace '^pnpm@', ''
if ($actualPnpm -ne $expectedPnpm) { throw "pnpm $actualPnpm != pin $expectedPnpm" }

$actualDotnet = (& dotnet --version).Trim()
if ($actualDotnet -ne $globalJson.sdk.version) { throw "dotnet $actualDotnet != pin $($globalJson.sdk.version)" }

$actualRust = (& rustc --version)
if ($actualRust -notmatch [regex]::Escape($rustChannel)) { throw "rustc does not match pin $rustChannel" }

$actualUv = (& $uv --version) -replace '^uv\s+([^\s]+).*$', '$1'
if ($actualUv -ne $uvExpected) { throw "uv $actualUv != pin $uvExpected" }

$actualWasmPack = (& wasm-pack --version) -replace '^wasm-pack\s+', ''
if ($actualWasmPack -ne $wasmPackExpected) {
    throw "wasm-pack $actualWasmPack != pin $wasmPackExpected"
}

$flatc = Resolve-Flatc
if ($flatc) {
    $actualFlatc = & $flatc --version
    if ($LASTEXITCODE -ne 0) { throw 'flatc version check failed' }
    if ($actualFlatc -notmatch [regex]::Escape($flatcExpected)) {
        throw "flatc $actualFlatc != pin $flatcExpected"
    }
} else { throw "flatc $flatcExpected is pinned but not installed" }

$nxExpected = $packageJson.devDependencies.nx
$nxVersionOutput = (& pnpm.cmd exec nx --version) -join "`n"
if ($nxVersionOutput -notmatch 'Local:\s*v?([0-9][0-9.]*)') {
    throw "could not parse local nx version from: $nxVersionOutput"
}
$actualNxLocal = $Matches[1]
if ($actualNxLocal -ne $nxExpected) {
    throw "nx (local, node_modules) $actualNxLocal != pin $nxExpected"
}
Write-Host "== nx (local) =="
Write-Host "v$actualNxLocal (pinned in package.json#devDependencies.nx, matches)"
if ($nxVersionOutput -match 'Global:\s*v?([0-9][0-9.]*)') {
    $actualNxGlobal = $Matches[1]
    if ($actualNxGlobal -ne $nxExpected) {
        Write-Host "note: global nx ($actualNxGlobal) differs from the pinned local nx ($nxExpected); harmless, because running 'nx' inside this repo defers to the local version, not the global one"
    } else {
        Write-Host "global nx matches the pin too ($actualNxGlobal)"
    }
} else {
    Write-Host "global nx: not installed (fine; the local pin governs everything inside this repo)"
}

if (-not $SkipWorkspaceChecks) {
    Invoke-Checked 'Cargo workspace check' { cargo check --workspace }
    Invoke-Checked 'uv lock check' { & $uv lock --check }
    Invoke-Checked 'Nx projects' { pnpm.cmd exec nx show projects }
}

Write-Host 'PASS: installed versions match the explicit pins checked by this script.'
