# Rust public API contract pilot — 2026-07-29

## Scope

I-003A pilots DEC-051 on the real `grafting-graph-core` consumer boundary. It
does not select TypeScript, C#, or Python extractors and does not introduce a
universal Grafting IDL for in-process APIs.

## Evaluated approaches

| Approach | Result | Reason |
| --- | --- | --- |
| Hand-written interface catalog | Rejected | It would duplicate Rust source and drift. |
| `cargo-public-api` global CLI | Not selected for the project contract | It produces the required signatures, but a globally installed binary would be outside `Cargo.lock`. |
| `public-api` + `rustdoc-json` as exact dev dependencies | Selected | The extractor is versioned in the existing Cargo workspace/lockfile and can generate a tracked baseline from native Rustdoc evidence. |
| `cargo-semver-checks` | Complementary future evaluation | It is useful for SemVer comparisons, especially against published or Git baselines, but does not replace the required tracked API-and-documentation report. |

The selected implementation follows the upstream library workflow while
removing its hidden installation side effect: the API test never installs a
toolchain. CI installs the separately pinned Rustdoc JSON nightly during setup;
the cacheable Nx target only reads source, generates derived build data, and
compares it with the tracked baseline.

Primary references:

- <https://github.com/cargo-public-api/cargo-public-api>;
- <https://docs.rs/public-api/0.52.1/public_api/>;
- <https://docs.rs/rustdoc-json/0.9.10/rustdoc_json/struct.Builder.html>;
- <https://github.com/rust-lang/rustdoc-types>;
- <https://github.com/obi1kenobi/cargo-semver-checks>.

## Pinned implementation

- authoritative compiler: root stable Rust `1.97.1`;
- extraction toolchain: `nightly-2025-11-23`, stored in
  `tools/rust-public-api-toolchain.txt`;
- `public-api = 0.52.1`;
- `rustdoc-json = 0.9.10`;
- `rustdoc-types = 0.57.4`;
- `serde_json = 1.0.151`.

The first attempted upstream minimum, `nightly-2025-08-02`, generated Rustdoc
JSON format 55. The current exact `public-api` release resolves
`rustdoc-types` format 57 and failed honestly with a missing `path` field. The
pin was moved to `nightly-2025-11-23`, immediately after Rustdoc JSON format 57
introduced `ExternalCrate.path`; generation then passed. The incompatible
attempt is retained here as evidence rather than hidden.

## Contract layers

1. Rust source and Rustdoc remain authoritative.
2. `#![deny(missing_docs)]` and broken-link denial ensure the public source has
   documentation.
3. `tests/public_api_snapshot.rs` generates one tracked report containing:
   public names, signatures, inputs, outputs, errors, trait guarantees, and
   Rustdoc text for authored public items.
4. `graph-core:api-check` compares the regenerated report without mutation and
   then compiles the independent consumer contract.
5. Existing behavioral tests protect identity, endpoint, determinism, cycle,
   snapshot, and Graph IR guarantees that signatures cannot express.

Intentional changes set `UPDATE_SNAPSHOTS=yes` only in the documented manual
update command. The resulting diff is reviewed with Rust source, documentation,
behavioral tests, and affected consumers.

## Validation evidence

The pilot passed on Windows with the repository-pinned stable toolchain and the
separately pinned extraction nightly:

- formatting and Clippy with warnings denied;
- all targets and all features for `grafting-graph-core`;
- the generated snapshot comparison and its negative drift-comparison test;
- the independent compile-time public consumer contract;
- Rustdoc generation with warnings denied by the crate attributes;
- the entire Cargo workspace test suite under `Cargo.lock`.

`cargo metadata --locked --offline` confirmed the exact versions and licenses
listed below. `cargo tree --edges normal` showed that the runtime dependency
tree remains only `petgraph` and its transitive dependencies; the extraction
libraries are development-only.

## Licenses

`public-api` and `rustdoc-json` are MIT. `rustdoc-types` and `serde_json` are
MIT OR Apache-2.0. They are development-only extraction dependencies and do not
enter the `grafting-graph-core` runtime API.

## Limits and next expansion

- Rustdoc JSON remains nightly-only and its format can change; exact pins and
  the tracked format number make that dependency visible.
- This pilot covers one real Rust package. I-003B must evaluate native
  TypeScript, C#, and Python extractors before expanding the convention.
- SemVer linting may be added as complementary evidence once a package has an
  appropriate release/Git baseline; it does not replace snapshot review or
  behavioral contracts.
- I-003A does not modify SECURITY-001 manifests, lockfiles, planning state, or
  generated graphs owned concurrently by Claude.
