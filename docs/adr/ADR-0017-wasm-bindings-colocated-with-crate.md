# ADR-0017: Generated Wasm bindings are co-located with their Rust crate, not a separate packages/ technical package

- Status: Accepted
- Proposal date: 2026-08-02
- Decision date: 2026-08-02
- Record: DEC-055
- Backlog item: WASM-CODEGEN-DIRECT-TO-APP
- Related gate: None
- Supersedes: None
- Amends: GRAFTING_MASTER_SOURCE.md section 9.2
- Related: ADR-0016
- Decision owner: repository-owner
- Source task: WASM-CODEGEN-DIRECT-TO-APP

## Summary

A Rust crate that compiles to Wasm (`libs/isekai/wasm-bridge`,
`libs/vtt/generation-wasm`) is *also* a normal pnpm workspace package: a
`package.json` co-located right next to its `Cargo.toml`, with a
`postinstall` script that runs `wasm-pack build` into that same directory.
Consuming apps depend on it exactly like any other workspace package
(`"@grafting/isekai-wasm": "workspace:*"` in `dependencies`, then a normal
`import`) -- no custom build script, no Nx target. A plain `pnpm install`
already produces working bindings, the same as any npm package with native
bindings. There is no separate `packages/*-wasm` technical package whose
only purpose is to hold generated output.

## Context

`GRAFTING_MASTER_SOURCE.md` section 9.2 previously documented
`packages/isekai-wasm` as "the technical package containing" `wasm-pack`'s
compiled output, a *separate* directory under `packages/` from the Rust
crate that produced it (`libs/isekai/wasm-bridge`), wired together by an Nx
`build` target on the library project (`wasm-pack build --target web
--out-dir ../../../packages/isekai-wasm/pkg`) and, for
`apps/architecture-studio`'s own Worker files, a further copy step
(`scripts/copy-wasm-assets.mjs`) into that app's `public/` directory.
`packages/vtt-generation-wasm` mirrored the same pattern for
`libs/vtt/generation-wasm`. Neither `pkg/` directory was committed
(`wasm-pack` writes its own `pkg/.gitignore` containing `*`), but the
`package.json`/`README.md`/`AGENTS.md` wrapper files around them were.

The repository owner directed removing this pattern, and the exact final
shape was reached through several corrections in conversation, each
rejecting a design that still had `packages/` (or the app) doing something
`wasm-pack`-adjacent that a plain dependency wouldn't:

1. First attempt: keep an Nx `build` target, but own it on the *consuming
   app*'s `project.json` instead of the library's, writing straight into
   that app's own `public/` directory. Rejected: "instead of it being via
   nx, is it possible to do it as if it were a normal package -- putting
   it in `package.json` and running a normal build/install already does
   the bridge, without me having to keep generating in `project.json`."
2. Second attempt: drop the Nx target, chain the `wasm-pack` invocation
   directly into the app's own `package.json` `build`/`dev` scripts
   (mirroring how `copy-wasm-assets.mjs` was invoked before). Rejected:
   "no, I'm talking about it being just in `dependencies`, nothing else,
   like a normal project, where it stays in `dependencies` and running
   build/install already generates everything correctly, like everything
   else."
3. Confirmed final shape (this ADR): the Rust crate's own directory becomes
   the npm package -- a co-located `package.json` with a `postinstall`
   script, consumed via a plain `workspace:*` dependency. Nothing
   `wasm-pack`-specific appears in any consuming app's `package.json` or
   `project.json` at all.

One further consequence surfaced once this was confirmed:
`apps/architecture-studio`'s Worker files (`layout.worker.ts`,
`generation.worker.ts`) previously fetched the compiled module at runtime
from a same-origin static asset path via a `webpackIgnore`-guarded dynamic
`import()`, specifically because `spikes/wasm-worker-nextjs` had
empirically found that statically importing wasm-bindgen output inside a
Next.js-bundled Worker did not work reliably. With the crate now a normal
workspace dependency, the owner chose to switch these Workers to a normal
static `import` as well, accepting the risk that this may reproduce the
problem the spike's runtime-fetch pattern was built to avoid -- to be
re-verified empirically as part of this task, not assumed.

`packages/isekai-web-client` (a hand-authored shared TS Worker/Promise
wrapper, not an app) already depended on `@grafting/isekai-wasm` via a
static import and a `workspace:*` dependency before this decision; that
does not change in substance, only in where `@grafting/isekai-wasm`'s own
`package.json` now lives.

## Scope

### In scope

- The location of `wasm-pack` (or an equivalent Wasm codegen tool's)
  output and its own npm package identity, for any Rust crate in `libs/`
  that targets `wasm32-unknown-unknown`.
- `packages/isekai-wasm` and `packages/vtt-generation-wasm` specifically
  (deleted), and any future crate of the same shape.
- `apps/architecture-studio`'s Worker files' loading strategy, to the
  extent it follows from no longer needing a static-asset copy step.

### Out of scope

- The Rust source of `libs/isekai/wasm-bridge` or `libs/vtt/generation-wasm`
  themselves.
- FlatBuffers-generated code and its existing committed-fixture exception
  (`ADR-0009`) — a different generator, a different rationale, unaffected.
- Any other kind of generated TypeScript/Rust code under `packages/`
  (e.g. `docs/generated/*`), which this ADR does not touch.

## Decision drivers

- The repository owner wants Wasm codegen to behave exactly like any
  ordinary npm package with native bindings: add it as a dependency, run
  the normal install/build command, done -- no bespoke orchestration layer
  (Nx target or hand-chained script) to keep in sync.
- `packages/` should only contain either authored, reusable source or a
  package whose own directory *is* its source of truth -- not a directory
  that exists solely to relay another directory's build output.
- Minimize moving parts: a co-located `postinstall` removes both the Nx
  target/`dependsOn` wiring and the `copy-wasm-assets.mjs` script in one
  step, rather than relocating either.

## Options considered

### Option A: App-owned Nx target (rejected)

An Nx target on the consuming app's `project.json` runs `wasm-pack` with
`--out-dir` pointing at that app's own asset directory, wired into
`dev`/`build` via `dependsOn`.

Rejected by the owner: still couples wiring the generation step to
`project.json`, the exact thing they asked to stop doing.

### Option B: App-owned package.json script (rejected)

Same output destination as Option A, but the `wasm-pack` invocation is a
plain `package.json` script on the consuming app, chained into `build`/
`dev` (`"build": "wasm-pack build ... && next build"`).

Rejected by the owner: still requires the consuming app to know about and
maintain a `wasm-pack` invocation at all; not "just a dependency."

### Option C: Co-located package, postinstall-triggered (chosen)

The Rust crate's own directory gets a `package.json` with a `postinstall`
script. Consuming apps add a plain `workspace:*` dependency; `pnpm install`
alone regenerates the bindings. No Nx target, no app-owned script, no
separate `packages/*-wasm` directory.

Chosen: matches the owner's explicit instruction exactly ("like a normal
project"), and is the same shape as how any npm package with a native
build step already works in this ecosystem.

## Decision

Accepted. Every Rust crate under `libs/` that compiles to Wasm carries its
own co-located `package.json` (same directory as its `Cargo.toml`) with a
`postinstall` script running `wasm-pack build --target web --out-dir pkg`.
Its `pkg/` output is gitignored. Consuming code depends on it as a normal
`workspace:*` package.json dependency and imports it statically -- no Nx
target, no app-owned build/dev script, no copy step, and no separate
`packages/*-wasm` directory. `packages/isekai-wasm` and
`packages/vtt-generation-wasm` are deleted.
`apps/architecture-studio/src/layout.worker.ts` and
`src/app/lab/generation.worker.ts` switch from a runtime static-asset
fetch to a normal static `import`, relying on Next.js's own bundler to
resolve and package the Wasm module for the Worker.

## Consequences

### Positive

- Generating working Wasm bindings for any of these crates is exactly
  `pnpm install` -- no separate build step, script, or Nx target to
  remember or keep in sync with `project.json`.
- `packages/` only contains directories that are either genuinely authored
  or are themselves the crate's own package identity, never a pure relay.
- Two fewer moving parts (an Nx target and a copy script) than the design
  this replaces.

### Costs and trade-offs

- `wasm-pack` now runs on every `pnpm install` for any workspace member
  that depends on one of these crates (transitively, on any full-workspace
  install), rather than only when a consuming app explicitly builds. This
  requires the Rust toolchain and `wasm-pack` to be present wherever
  `pnpm install` runs, including CI.
- Switching `apps/architecture-studio`'s Worker files to a static `import`
  reopens a question `spikes/wasm-worker-nextjs` had previously closed
  empirically (that this specific combination -- wasm-bindgen output,
  statically imported inside a Next.js-bundled Dedicated Worker -- did not
  work reliably). This must be reverified as part of this task's
  verification step, with a documented fallback to the runtime-fetch
  pattern if it does not hold.
- If a crate's Wasm bindings are ever needed without pulling in the whole
  Rust toolchain at install time (e.g. a consumer that only wants the
  crate's plain Rust API), that is no longer separable from this package's
  `postinstall`; not a concern for any current consumer.

## Compatibility and migration

- `libs/isekai/wasm-bridge/project.json` and
  `libs/vtt/generation-wasm/project.json` carry no `build` target (removed
  in an earlier pass of this same task); `check`/`test`/`docs-generate`/
  `docs-check` are unaffected. Wasm generation itself is not an Nx target
  at all as of this decision.
- `libs/isekai/wasm-bridge/package.json` and
  `libs/vtt/generation-wasm/package.json` are new: `name`
  `@grafting/isekai-wasm` / `@grafting/vtt-generation-wasm` (unchanged from
  the deleted `packages/*` packages -- only their location moved), `main`/
  `types` pointing at `./pkg/...`, a `postinstall` script.
- `apps/architecture-studio/package.json` declares
  `"@grafting/isekai-wasm": "workspace:*"` and
  `"@grafting/vtt-generation-wasm": "workspace:*"` in `dependencies`; its
  `build`/`dev` scripts are unchanged plain `next build` /
  `concurrently ...` (no `wasm-pack` mention anywhere in this app).
- `apps/architecture-studio/scripts/copy-wasm-assets.mjs` is deleted.
- `apps/architecture-studio/src/layout.worker.ts` and
  `src/app/lab/generation.worker.ts` import `@grafting/isekai-wasm` /
  `@grafting/vtt-generation-wasm` statically instead of fetching a
  `public/`-served static asset at runtime.
- `packages/isekai-web-client` is unchanged in substance (already
  statically imported `@grafting/isekai-wasm` via `workspace:*` before this
  decision).
- `GRAFTING_MASTER_SOURCE.md` section 9.2 is rewritten to describe the new
  rule and reference this ADR; the artifact table and Nx target
  dependency-chain diagram elsewhere in the master source that mention
  `packages/isekai-wasm` are updated to match.

> **Footnote (2026-08-04, owner direction in conversation):** this ADR's
> concrete example crate, originally `libs/vtt/generation-wasm`
> (`@grafting/vtt-generation-wasm`), was relocated to
> `libs/domains/procgen/generation-wasm` (`@grafting/procgen-generation-wasm`)
> as part of reclassifying procedural-generation crates as a generic domain
> rather than a VTT-product-specific one -- see
> `docs/adr/ADR-0008-libs-boundary-and-domain-map.md`'s own footnote and
> `GRAFTING_MASTER_SOURCE.md` §4.4. The co-located-`package.json` pattern
> this ADR establishes is unaffected; only that one example crate's path and
> name changed. The body below is left as the historical record of the
> 2026-08-02 decision, not rewritten.

## Validation and evidence

- Acceptance criterion: after migration, `packages/isekai-wasm` and
  `packages/vtt-generation-wasm` do not exist on disk at any point during a
  clean `pnpm install`, and `apps/architecture-studio` still builds and
  serves working Wasm modules through both Worker files.
- Evidence: `libs/isekai/wasm-bridge/package.json` and
  `libs/vtt/generation-wasm/package.json`'s `postinstall` scripts produce
  `pkg/` on `pnpm install`; a passing `next build`/`next dev` for
  `apps/architecture-studio` with the Graph IR explorer and VTT generation
  lab page both rendering real Wasm-computed output in a browser; a
  passing `pnpm --filter @grafting/isekai-web-client test` and
  `tsc --noEmit`; a full local reproduction of
  `.github/workflows/ci.yml`'s `linux` job.

## Risks

- The static-import Worker change (Consequences, above) is the one
  concrete open risk: if Next.js's bundler still cannot handle
  wasm-bindgen output inside a Dedicated Worker reliably, this must be
  caught during verification and reverted to the runtime-fetch pattern for
  the affected Worker(s), not shipped unverified.
- `wasm-pack` becoming a `pnpm install`-time dependency for the whole
  workspace (rather than only for whoever explicitly builds the consuming
  app) must be reflected in CI/dev-environment setup documentation; missed
  environments will see `pnpm install` fail outright rather than silently
  produce a stale build.

## Rollback

Remove the `postinstall` script and `package.json` from the affected
`libs/*` crate directories, remove the corresponding `workspace:*`
dependency from consumers, and reintroduce either Option A or Option B
above (an Nx target or an app-owned script) plus a `packages/<name>/pkg`
output directory. Revert the two Worker files to the runtime static-asset
fetch pattern if the static-import risk above materializes. No persisted
data format is involved; this is build/tooling wiring only.

## Follow-up work

- Confirm during this task's verification step whether the static-import
  Worker change actually works under both `next dev` and `next build`; if
  not, revert just that piece to the runtime-fetch pattern and record why
  in the task's `risks`, without reopening the rest of this decision.
- Document the `wasm-pack`/Rust-toolchain-at-install-time requirement
  wherever this repository's environment setup is described, if not
  already covered by existing Rust-toolchain setup docs.
