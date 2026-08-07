# CI/CD and testing

Relocated verbatim from `GRAFTING_MASTER_SOURCE.md` sections 18-19 on 2026-08-07, as the
router table in that document's S0.4 had scheduled. The section numbering is
preserved because `S<n>.<n>` is the stable citation key used from real source
comments and manifests; those citations resolve here now, unchanged.
Precedence and normative language remain in `GRAFTING_MASTER_SOURCE.md`
section 0 and govern everything below.

---

## 18. CI/CD

### 18.1 Principles

- installation happens before Nx;
- cacheable tasks do not perform installation;
- runners use lockfiles;
- cache is partitioned by OS, architecture, profile, and toolchain;
- real GPU is tested separately from CPU CI;
- publish/sign/deploy are never restored from cache.

### 18.2 Pull Request pipeline

Steps:

1. checkout;
2. validate toolchain versions;
3. `pnpm install --frozen-lockfile`;
4. `uv lock --check`;
5. `uv sync --locked`;
6. `cargo metadata` and lock check;
7. `dotnet restore --locked-mode`, when applicable;
8. codegen;
9. `nx affected` for format/lint/typecheck/test/build;
10. validate ABI and protocol;
11. extract and validate Graph IR;
12. block forbidden architectural relations;
13. generate context packs and documentation;
14. validate `.ai/`, registries, skills, and references;
15. compile prompts and generate adapters;
16. detect drift;
17. run quick evals;
18. review permission and MCP expansion;
19. check for unexpected artifacts.

### 18.3 Native matrix

| Runner      | Artifacts                                 |
| ----------- | ----------------------------------------- |
| Linux x64   | Wasm, `.so`, Rust/Python/TS tests       |
| Windows x64 | `.dll`, C# wrapper, desktop V1          |
| macOS arm64 | `.dylib`, future Metal/wgpu validation |

Do not assume a Linux build is equivalent to validating DirectX or Metal.

### 18.4 GPU tests

Normal pipeline:

- validates WGSL;
- compiles the backend;
- tests CPU fallback;
- runs tests without requiring a dedicated GPU.

GPU pipeline, nightly/manual:

- runs on known hardware;
- collects adapter/features/limits;
- runs benchmarks;
- tests device loss when possible;
- compares result against CPU within tolerance;
- publishes a report, not cached as eternal truth.

### 18.5 Release

While everything is internal:

- one product version;
- artifact manifest;
- separate ABI/protocol versions;
- build ID and git SHA;
- checksums.

Manifest:

```json
{
  "productVersion": "0.1.0",
  "coreVersion": "0.1.0",
  "abi": { "major": 1, "minor": 0 },
  "protocol": { "major": 1, "minor": 0 },
  "gitSha": "<sha>",
  "target": "x86_64-pc-windows-msvc",
  "profile": "release",
  "features": ["cpu", "wgpu"]
}
```

Nx Release may coordinate versions and changelogs, but Cargo/NuGet/Python publication will require explicit adapters. Do not assume automatic polyglot publication.

---

## 19. Testing

### 19.1 Pyramid

1. pure domain tests;
2. property-based tests;
3. CPU versus GPU differential tests;
4. contract tests;
5. ABI tests;
6. binding integration tests;
7. host tests;
8. e2e;
9. benchmarks.

### 19.2 Domain

Test:

- invariants;
- invalid commands;
- transitions;
- controlled RNG;
- replay;
- state hash;
- snapshots.

### 19.3 CPU versus GPU

For each kernel:

- generate small cases;
- run on CPU;
- run on GPU;
- compare within tolerance;
- include NaN, infinity, empty, boundary cases;
- test devices with minimal features.

Do not require bit-for-bit floating-point equality without mathematical justification.

### 19.4 ABI

Test:

- compatible version;
- incompatible major;
- smaller/larger `struct_size`;
- invalid handle;
- double release;
- use-after-release;
- null pointer;
- empty buffer;
- internal panic;
- shutdown with pending jobs;
- missing library;
- wrong architecture.

### 19.5 Memory

Test:

- leaks;
- arena growth;
- leases;
- short pinning;
- Worker termination;
- `memory.grow`;
- device loss;
- release after cancellation.
