# Nx and toolchain validation spike — 2026-07-28

Status: **accepted; foundational spike 6 complete.**

## Installed and checked

| Tool | Version | Canonical pin/check |
| --- | --- | --- |
| Node | 22.20.0 | `.node-version` |
| pnpm | 11.17.0 | `package.json#packageManager` |
| Nx | 23.1.0 | exact `package.json` dependency + `pnpm-lock.yaml` |
| Rust/Cargo | 1.97.1 | `rust-toolchain.toml` |
| Python | 3.12.13 installed; 3.12 line selected | `.python-version` + `uv.lock` |
| uv | 0.11.32 | `tools/uv-version.txt` |
| .NET SDK | 10.0.302 | `global.json` |
| wasm-pack | 0.15.0 | `tools/wasm-pack-version.txt` |
| flatc | 25.12.19 | `tools/flatc-version.txt` |

`tools/scripts/validate-toolchains.ps1` verifies the installed versions and
runs Cargo workspace check, uv lock check, and Nx project discovery. On
Windows it resolves WinGet-installed `uv` and `flatc` even when the WinGet link
is inaccessible or missing from the current process's `PATH`.

## Nx observations

- Nine projects discovered.
- Generated graph: nine nodes and seven dependency edges.
- Cache proof after `nx reset`:
  - first `engine-compute-api:check`: 0/1 hit, 619 ms;
  - second identical run: 1/1 hit, 10 ms.
- Explicit affected proof:
  - changing `domain-core` selects `domain-core`, both native/Wasm bindings,
    the .NET protocol/interop layers, and the Web client;
  - changing `compute-api` selects only `compute-api` and `compute-cpu`.

This proves local dependency direction and caching. It does not replace a real
GitHub Actions run or prove remote cache behavior.

## `@nx/dotnet` disposition (A-010)

The official plugin is real and supported for Nx 22+ and .NET SDK 8+; this
workspace meets those prerequisites. It can infer projects and MSBuild tasks.
The current repository nevertheless retains explicit `project.json`
`nx:run-commands` targets for now:

- GATE-002 is in indefinite standby;
- the existing explicit targets already build/test the small generic interop
  surface and expose the intended cross-language dependencies;
- adopting inference now would add a plugin and risk duplicated or renamed
  targets without advancing an active C# product.

A-010's fallback criterion is therefore satisfied: explicit targets are the
documented fallback. Re-evaluate `@nx/dotnet` when GATE-002 is explicitly
resumed or when the .NET project count makes manual metadata costly.

Primary current reference: Nx's official “Nx with .NET” documentation.

## Gaps discovered

- Windows/.NET CI remains B-010.
- The Linux workflow has not run on a real GitHub runner from this repository.
- `.python-version` selects the 3.12 line rather than an exact patch; `uv.lock`
  and the environment record the resolved packages, while patch-level Python
  portability remains intentional.

## Disposition

Carry forward the validation script, exact Node/Nx/uv/wasm-pack pins, generated
Nx graph, and explicit .NET fallback. The spike adds no workspace root,
lockfile, runtime dependency, or product architecture.
