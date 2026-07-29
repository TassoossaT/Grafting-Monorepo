# `tools/scripts/`

Repo-tooling scripts, invoked via `pnpm <script>` (root `package.json`)
or directly with `node`. All "generate a derived doc" scripts here share
one convention (established by `generate-graph-ir.mjs`, master source
S16.1/S17): plain Node ESM, no dependency beyond Node built-ins,
deterministic output, and a `--check` flag that diffs against the
committed file and exits non-zero on drift instead of silently rewriting
it.

## Derived documentation (G-003, G-004)

- `generate-repo-map.mjs` (`pnpm graph:map` / `graph:map:check`) --
  `docs/generated/repo-map.md`, every real Nx project grouped by
  ecosystem tag, read from `docs/generated/project-graph.json`.
- `generate-artifact-manifest.mjs` (`pnpm graph:manifest` /
  `graph:manifest:check`) -- `docs/generated/artifact-manifest.json`,
  matching master source S18.5's literal shape. `abi`/`protocol`/
  `features` come from a real runtime value
  (`cargo run -p grafting-isekai-capi --features abi-info-cli --bin
  abi-info-cli`, see that crate's `src/bin/abi_info_cli.rs`), not from
  parsing Rust source. `gitSha`/`target` are computed live
  (`git rev-parse HEAD` / `rustc -vV`'s `host:` line) -- `--check` only
  compares everything else, since those two legitimately vary per
  run/machine.

## Scaffolding generators (G-006, G-007)

- `generate-rust-crate.mjs` -- scaffolds a new Rust crate (`Cargo.toml`,
  `src/lib.rs`, `README.md`, `AGENTS.md`, `project.json`) matching every
  existing crate's shape, and appends the new path to root `Cargo.toml`'s
  `members` array. Exports `scaffoldCrateFiles`/`setProjectRoot`/
  `appendWorkspaceMember` as a library, reused by the domain generator
  below. CLI: `node tools/scripts/generate-rust-crate.mjs --name <nx-name>
  --path <libs/area/crate-dir> --tags <tag,tag> [--package <cargo-name>]
  [--description <text>]`.
- `generate-domain.mjs` -- scaffolds a domain slice under
  `libs/domains/<name>`, per master source S17.2's exact input/output
  spec (name, tags, needs a contract?, needs compute?, needs a public
  binding?). Refuses to scaffold a public binding unless
  `--force-binding` is also passed (S17.2, verbatim: "do not create
  bindings for every domain automatically; prefer an aggregated engine
  API"). CLI: `node tools/scripts/generate-domain.mjs --name <domain-name>
  [--contract] [--compute] [--binding] [--force-binding]`.

Neither generator creates anything under the real tree by running its
own test suite (master source S4.3, `LOCKED`: "Empty directories must
not be created ahead of time") -- `generate-rust-crate.test.mjs` and
`generate-domain.test.mjs` scaffold into a uniquely-named, in-repo,
non-`.gitignore`d scratch directory (`libs/.generator-*-test-<id>/`),
assert real `cargo check` success and real Nx discoverability
(`pnpm exec nx show projects --json`), then delete it. Using either
generator to create a real, permanent crate/domain is a decision for
whoever has a real one to add -- not something these tests do.

## AI coordination / Graph IR (Codex-authored, listed here for discoverability)

- `generate-graph-ir.mjs` / `validate-graph-ir.mjs` (+ their `.test.mjs`
  files) -- `pnpm graph:generate` / `graph:check`, `pnpm graph:v1:check`
  / `graph:v1:test`. See `docs/graph-ir/README.md`.
- `bootstrap.ps1`, `validate-toolchains.ps1` -- workspace bootstrap and
  toolchain-pin verification (Epic B).
- `generate-contracts.ps1`, `get-flatc-csharp.ps1` -- FlatBuffers codegen
  for `libs/engine/domain-core/contracts/*.fbs` (C-005/C-006). See
  `libs/engine/domain-core/contracts/README.md`.
