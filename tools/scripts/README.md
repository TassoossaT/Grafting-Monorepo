# `tools/scripts/`

Repo-tooling scripts, invoked via `pnpm <script>` (root `package.json`),
directly with `node`, or via `nx run grafting:<target>` (root
`project.json` wraps every root `package.json` script as an Nx target,
so the whole workspace -- Rust, TypeScript, and these scripts -- is
runnable through `nx` alone). All "generate a derived doc" scripts here share
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

## Graph IR v1 extractor (I-004)

- `graph-ir-extract.mjs` (`pnpm graph:extract` / `graph:extract:check`) --
  the real Nx to Graph IR v1 extractor. Reads the committed
  `docs/generated/project-graph.json` and each project's manifest
  (`project.json`, falling back to `package.json` for the one real project
  without one) and produces `docs/generated/grafting.graph.json`:
  `project`/`target` nodes and `contains`/`depends_on` edges, the
  Nx-sourced slice of the v1 contract (task/agent/handoff/skill/prompt
  coverage stays `.ai/`-sourced and out of scope; see I-006/J-012).
  Collapses Nx's own `implicit`+`static` dependency-type duplication into
  one `depends_on` edge per project pair (`declared`/confidence 1 if an
  authored `implicitDependencies` entry exists, else `derived`/confidence
  0.95 from Nx's inference alone); the same declared/derived split applies
  to Nx-plugin-inferred targets absent from a project's own manifest (e.g.
  `architecture-studio`'s `dev` target). `sourceRevision` is a deterministic
  SHA-256 fingerprint of this extractor's exact input paths and bytes, never
  Git history or a whole-repo `git status` scan. It therefore stays identical
  in a local checkout, a shallow clone and GitHub's synthetic merge ref without
  becoming self-referential. Self-checks its own
  output against both Graph IR validation layers (JS schema/semantics via
  `validate-graph-ir.mjs`, Rust structural invariants via
  `graph-ir-cli`, per DEC-051) before writing. `grafting.graph.spike.json`
  and its Architecture Studio spike-viewer consumer are untouched; see
  `docs/graph-ir/README.md`/`AGENTS.md`.

## Unified drift check (I-007, G-008)

- `pnpm docs:check` -- one entry point, no duplicated drift logic. Chains
  seven already-existing, already-tested checks (a plain `&&` sequence in
  root `package.json`, not a new script): `graph:map:check` (G-003),
  `graph:manifest:check` (G-004), `graph:extract:check` (I-004, the real
  `grafting.graph.json` -- not the frozen spike's `graph:check`, and not
  `graph:v1:check`, which validates a static fixture rather than repo
  state), `docs:api:ts:check` and `docs:api:rust:check`
  (G-DOCS-TYPEDOC-API-REFERENCE / G-DOCS-API-COVERAGE-EXPANSION, below),
  `nx run graph-core:api-check` (I-003A, Rust public-API baseline),
  `nx run x6-canvas:api-check` (I-003B, TypeScript public-API baseline).
  Fails fast on the first stale check, naming the actual stale file (each
  underlying script's own error message). `.github/workflows/ci.yml` runs
  it as one "Docs and Graph IR drift check" step, replacing what used to
  be two separate/bundled `api-check` invocations -- same coverage, same
  relative order, consolidated. CI still never regenerates
  `docs/generated/project-graph.json` itself; that's a pre-existing gap,
  not something this closes.

## API-reference extractors (G-DOCS-TYPEDOC-API-REFERENCE, G-DOCS-API-COVERAGE-EXPANSION, G-DOCS-API-AUTODISCOVERY-AND-NOISE-FILTER, G-DOCS-API-MARKDOWN-FORMAT, G-DOCS-PER-PROJECT-REGEN-RULE)

Owner-directed intent: this evidence exists primarily so AI agents can
look up a project's real exported shape and doc comments as compact
structured data instead of re-parsing source -- human browsing is
secondary. No HTML site, no new app; that stays a separate, larger
choice. Neither script hardcodes which projects/crates to cover -- both
discover targets from data Nx/Cargo themselves already treat as
authoritative, so a new package or crate needs no edit here to be
covered.

Per `PROTOCOL.md`'s completion rule: an agent whose task touched a
documented project's `src/` regenerates that project's evidence before
marking the task complete, scoped to only what it touched, not the whole
repo. The primary, always-works mechanism is both scripts' optional
positional target name (`node tools/scripts/generate-api-docs.mjs ui`,
`node tools/scripts/generate-rust-api-docs.mjs grafting-graph-core`) --
needs no per-project setup, since target discovery itself is dynamic (see
above/below), so it works immediately even for a project the same task
just created. Where it already exists, prefer the equivalent `nx run
<project>:docs-generate`/`docs-check` target instead: every project
documented as of G-DOCS-PER-PROJECT-REGEN-RULE has it wired by hand, and
`generate-rust-crate.mjs` (below) now scaffolds it into every *new* Rust
crate automatically. TypeScript has no equivalent scaffolding generator
in this repo (`packages/ui`, `x6-canvas`, `isekai-web-client` were all
hand-authored) -- copy the `docs-generate`/`docs-check` block from an
existing sibling `project.json` (e.g. `packages/ui/project.json`) into a
new TS project's own if you want the Nx convenience target there too;
its absence is never a blocker, only the direct script call is required.
No argument processes every discovered target, which is what the root
`docs:api:ts:check`/`docs:api:rust:check` (wired into `docs:check` and
CI) still calls, as the backstop that catches anything an agent's
per-project step missed.

After regenerating, run the `docs-quality-check` skill
(`.claude/skills/docs-quality-check/SKILL.md`, G-DOCS-QUALITY-CHECK-SKILL)
against the regenerated file before marking the task complete. It reviews
the file for the same four bug categories already found and fixed by
hand in these generators (size outliers, silently-empty output,
undocumented-noise ratio, formatting artifacts) and reports a suggested
generator fix if it finds one -- `disallowed-tools: Write, Edit` in its
own frontmatter means it can only suggest, never hand-edit the generated
file or the generator itself.

Output is Markdown (`### signature` header, doc paragraph below), not
JSON, matching the shape `libs/graph/core/tests/snapshots/public-api.txt`
already proved for this repo. The owner asked directly whether an LLM
handles JSON and Markdown the same way -- it does not, quite: for the one
real consumer that exists today (an agent reading the whole file whole),
JSON's punctuation (braces, quotes, escaped `\n`) is pure overhead, and
Markdown's header-per-symbol shape is a closer match to how doc comments
actually read. JSON would only clearly win once something parses this
programmatically (e.g. a future Graph IR ingestion step) -- that does not
exist yet, and would reprocess from the Rust/TS source again regardless
of this file's current format, so optimizing for it now would have been
premature.

- `generate-api-docs.mjs` (`pnpm docs:api:ts:generate` / `docs:api:ts:check`)
  -- the TypeScript side; the one script in this directory that breaks the
  "no dependency beyond Node built-ins" convention stated above, using
  TypeDoc's Node API (pinned exact version, matching this repo's no-caret
  convention) to build a reflection tree, then a hand-written renderer
  (`collectEntries`/`renderMarkdown`) walks it into the flat Markdown
  shape -- not TypeDoc's own native JSON model, which carries per-node
  bookkeeping (`id`/`variant`/`flags`) that is noise for this purpose.
  Discovers targets by reading every `packages/*/project.json` and
  `apps/*/project.json`, keeping only projects tagged `lang:typescript`.
  Two shapes of target, written to `docs/generated/api/ts/<project.json
  name>.api.md`: `projectType: "library"` converts a single entry point
  (`metadata.publicApi.entryPoint` where `check-typescript-public-api.mjs`
  already governs it, else `package.json`'s `types`/`main` field if it
  resolves to a real `.ts` file); `projectType: "application"` (no package
  export surface to speak of -- currently just `apps/architecture-studio`)
  lists every real `.ts` module under `src/` directly instead, excluding
  ambient `.d.ts` files -- that document describes internal structure,
  not a public API surface. Each per-file module wrapper TypeDoc creates
  for that case is named after its own basename, not the full relative
  path (`pathSegmentName`), and is a transparent grouping node in the
  output (no entry of its own) unless it carries a real file-level doc
  comment. A project is silently skipped, not an error, if it has no
  `project.json`, isn't tagged `lang:typescript`, or resolves to zero
  entry points -- `libs/isekai/wasm-bridge` and `libs/domains/procgen/generation-wasm`
  (Rust crates that are also normal npm packages purely to host their own
  generated Wasm bindings, DEC-055/ADR-0017; their own `package.json` says
  "No domain logic here") fall out this way via their `lang:rust` tag
  rather than needing an explicit exclusion. `disableGit`/`disableSources` keep
  the underlying reflection data machine-independent (no absolute paths,
  no git-remote dependency), and entry/tsconfig/basePath are posix-ified
  before being handed to TypeDoc, since its glob matching rejects Windows
  backslash separators even on a Windows host.
- `generate-rust-api-docs.mjs` (`pnpm docs:api:rust:generate` /
  `docs:api:rust:check`) -- the Rust side. Discovers crates by
  text-parsing the root `Cargo.toml`'s own `[workspace] members` array
  (same convention as `generate-artifact-manifest.mjs`'s Cargo.toml reads:
  no TOML parser dependency for one field) and skipping any member with no
  `src/lib.rs` -- bin-only crates have nothing for `--lib` to document,
  which is what excludes `tools/rust-api-docgen` itself from its own
  output. For each remaining crate, shells out to `tools/rust-api-docgen`
  (below) and writes its curated Markdown to
  `docs/generated/api/rust/<crate>.md`. Real problems found and fixed
  here, in order: an early version committed the *raw* Rustdoc JSON model
  (one file was 1.5 MB, because rustdoc's own JSON index carries one
  entry per `impl` block); after switching to a curated JSON map, the
  owner inspected a real file directly and found over half its entries
  were still undocumented `#[derive(...)]`-generated impls/methods
  (`Clone`/`Debug`/`Eq`/`Hash`/marker traits/etc) with no signal at all
  (`is_undocumented_derive_noise` fixed that); finally, switched the
  curated JSON map itself to Markdown for the reason above. Combined
  effect across all 6 real crates: 2.4 MB (raw JSON) -> 234 KB (curated
  JSON) -> 160 KB (curated + filtered JSON) -> 154 KB (curated + filtered
  Markdown, comparable bytes but meaningfully more readable per byte:
  no escaped `\n`, no repeated quoting).

## Rust API-reference tool (`tools/rust-api-docgen`)

- A small standalone binary crate (workspace member, not under `libs/`
  since it is cross-cutting dev tooling, not domain code), generalizing
  the Rustdoc JSON + `public-api` curation
  `libs/graph/core/tests/public_api_snapshot.rs` already proves for its
  own narrow public-API drift check (see I-003A) to any of the six real
  Cargo workspace members: `rustdoc_json::Builder` builds Rustdoc JSON
  with the pinned nightly (`tools/rust-public-api-toolchain.txt`),
  `public_api::Builder` derives the genuinely public surface (blanket
  impls omitted, matching that existing usage), and the result is
  rendered as a level-3 Markdown header naming the signature, with the
  doc comment as the body below -- not the curated *text* baseline drift
  check renders from the same underlying data, which has a different
  fixed shape (a `Signatures` code block plus a `Documentation evidence`
  section) built for a diff review, not as general-purpose evidence.
  `is_undocumented_derive_noise` additionally drops any undocumented
  trait-impl-block declaration and any undocumented `pub fn` whose method
  name is one of a fixed denylist
  (`clone`/`eq`/`ne`/`fmt`/`hash`/`cmp`/`partial_cmp`/`default`) --
  `#[derive(...)]`-only noise, never anything that has gained a real doc
  comment (the filter only applies when the item has no doc). A denylist
  heuristic, not semantic analysis: an undocumented hand-written `fmt`,
  `eq`, or `clone` impl with real behavior is filtered the same as a
  derived one -- accepted, since a doc comment is what makes it reappear.
  Usage: `cargo run -p grafting-rust-api-docgen -- PACKAGE_NAME
  OUTPUT_PATH`.

## Scaffolding generators (G-006, G-007)

- `generate-rust-crate.mjs` -- scaffolds a new Rust crate (`Cargo.toml`,
  `src/lib.rs`, `README.md`, `AGENTS.md`, `project.json`) matching every
  existing crate's shape, and appends the new path to root `Cargo.toml`'s
  `members` array. The scaffolded `project.json` includes
  `docs-generate`/`docs-check` targets (G-DOCS-NEW-PROJECT-REGEN-GAP) so a
  brand-new crate gets the same `nx run <name>:docs-generate` convenience
  the 10 pre-existing documented projects have, without a manual step.
  Exports `scaffoldCrateFiles`/`setProjectRoot`/
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
(`nx show projects --json`), then delete it. Using either
generator to create a real, permanent crate/domain is a decision for
whoever has a real one to add -- not something these tests do.

## AI coordination / Graph IR (Codex-authored, listed here for discoverability)

- `agent-task-guard.mjs` (+ `.test.mjs`) -- provider-neutral runtime adapter
  for task ownership and the agent Git-write prohibition. It rejects explicit
  or implicit commit creation, PR merges, unsafe pulls, non-isolated pushes,
  and every push to `main`/`master`, even with an active task. Claude Code
  invokes it through the project
  `PreToolUse` hook in `.claude/settings.json`; the canonical policy remains
  `.ai/coordination/PROTOCOL.md` and `.ai/state/tasks/`.
- `generate-graph-ir.mjs` / `validate-graph-ir.mjs` (+ their `.test.mjs`
  files) -- `pnpm graph:generate` / `graph:check`, `pnpm graph:v1:check`
  / `graph:v1:test`. See `docs/graph-ir/README.md`.
- `bootstrap.ps1`, `validate-toolchains.ps1` (`pnpm toolchains:check` /
  `nx run grafting:toolchains-check`) -- workspace bootstrap and
  toolchain-pin verification (Epic B), including the local `nx` version
  against `package.json#devDependencies.nx` and whether a global `nx`
  install (if any) differs from it.
- `generate-contracts.ps1`, `get-flatc-csharp.ps1` -- FlatBuffers codegen
  for `libs/engine/domain-core/contracts/*.fbs` (C-005/C-006). See
  `libs/engine/domain-core/contracts/README.md`.
- `doc-size.mjs` -- shared thresholds/classification ("ok"/"large"/
  "colossal" by line count) and the generated/snapshot exclusion, used by
  both of the following so they never drift on what counts as large.
- `check-doc-organization.mjs` -- manual, on-demand report of every
  authored Markdown document past those thresholds (`node
  tools/scripts/check-doc-organization.mjs`), so an oversized document gets
  noticed and split into a router plus linked sub-documents instead of
  growing forever. Report only, never edits anything.
- `doc-size-reminder.mjs` (+ `.test.mjs`) -- `PostToolUse` reminder (wired
  in `.claude/settings.json`) giving the same signal inline right after an
  edit leaves an authored Markdown document "large" or "colossal".
  Advisory only, same non-blocking shape as `research-registry-reminder.mjs`.
- `context-resolver.mjs` (+ `.test.mjs`) -- materializes the "context pack"
  concept named in `docs/architecture/ai-control-plane.md` §16.9 (DEC-050)
  but never implemented before this. Given a task ID (reads that task's own
  `affected_paths`/`title`/`objective`, per DEC-031) or an explicit
  `--paths a.ts,b.rs`, resolves and prints (never inlines) the small slice
  of `AGENTS.md` files, `GRAFTING_MASTER_SOURCE.md` §0.4 router rows, and
  `docs/adr/README.md` ADRs actually relevant to it, backed by Nx's own
  project graph (`docs/generated/project-graph.json` for project roots,
  `nx show projects --affected --files=... --json` for real
  dependency-graph-aware downstream impact, per DEC-021 -- no new
  dependency). Manual usage: `node tools/scripts/context-resolver.mjs
  --task <TASK_ID>`. Known limitation: a task whose `affected_paths`
  includes root-level/global files (`nx.json`, root `AGENTS.md`, a whole
  `tools/scripts/` directory) will legitimately make Nx mark most of the
  workspace as affected -- a correct answer given Nx's own model, just not
  a sharp signal for that specific task.
- `context-resolver-hook.mjs` (+ `.test.mjs`) -- `PostToolUse` reminder
  (wired in `.claude/settings.json`) that runs `context-resolver.mjs`
  automatically whenever a `Write`/`Edit` leaves a `.ai/state/tasks/`
  record at `status: "in_progress"`, so the digest above appears right
  after a task is claimed without a manual command. Advisory only, same
  non-blocking shape as the other reminders; re-fires on later edits to an
  already-`in_progress` record too (checks current state, not a diff, same
  tradeoff `doc-size-reminder.mjs` already accepts).
