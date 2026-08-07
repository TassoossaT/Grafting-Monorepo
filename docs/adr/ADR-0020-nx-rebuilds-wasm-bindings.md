# ADR-0020: Nx rebuilds Wasm bindings, while install still generates them

- Status: Proposed
- Decision owner: repository-owner
- Decision date: 2026-08-06
- Record: DEC-058
- Supersedes: None
- Amends: ADR-0017
- Related: DEC-015, DEC-051, DEC-055

## Decision

Every Rust crate that compiles to Wasm gains an Nx `build` target running the
same `wasm-pack build --target web --out-dir pkg` its `postinstall` already
runs, with `pkg/` declared as the target's output so Nx caches it. Consuming
projects declare that target in `dependsOn` for every target that needs the
generated bindings to exist: `architecture-studio`'s `check`, `dev`, and
`build`, and `isekai-web-client`'s `check` and `test`.

ADR-0017's `postinstall` remains exactly as it is, and remains the mechanism
that makes a fresh clone work. This ADR amends only ADR-0017's clause reading
"no Nx target": it adds a second, additive path for the case `postinstall`
structurally cannot serve, and does not move binding generation out of the
crate or into any consuming app.

`grafting-isekai-wasm` also declares `engine-domain-core:generate` in
`dependsOn` for its `build`, `check`, and `test`, because it compiles
`grafting-domain-core`, whose source does not exist until `flatc` has produced
it.

## Context

ADR-0017 chose `postinstall` so that adding a Wasm crate is "just a
dependency", and explicitly rejected an Nx target twice. That decision holds
for the case it was reasoned about: a fresh clone or a new dependency.

It leaves a different case unserved. `postinstall` runs at install time, and
Rust source changes without an install. `nx dev architecture-studio` therefore
compiled nothing Rust and served a `pkg/` that could be arbitrarily old.
`implicitDependencies` did not help — it informs the project graph but executes
nothing, and the crates had no target to execute anyway.

This is not hypothetical. Adding `evaluation_order_json` to the Wasm bridge
(DEC-057) produced a `pkg/` without it, and `tsc` failed against a stale
declaration file. The failure was at least loud; a signature that changed
rather than appeared would have failed at runtime instead.

The repository owner asked for `nx dev` to build its dependencies after seeing
exactly this.

## Consequences

- Benefit: changing Rust source and running any Nx target rebuilds what depends
  on it, which is what the rest of the repository already does for TypeScript.
- Benefit: Nx caches `pkg/` against the crate's sources and its dependencies,
  so an unchanged crate costs nothing.
- Benefit: the missing `engine-domain-core:generate` edge is fixed with it. Its
  absence was a latent failure in `isekai-wasm-bridge:check` and `:test` that
  only stayed hidden because a full install happened to run `flatc` first.
- Cost: two places now invoke `wasm-pack` for the same crate. They run the same
  command with the same flags, and a divergence would show up as a rebuild that
  produces different output than a fresh install — worth a review check when
  either changes.
- Cost: `nx dev` and `nx build` now require the Rust toolchain and `wasm-pack`.
  ADR-0017 already imposed that on `pnpm install`, so no environment that could
  install this repository loses the ability to build it.
- Risk: it partly reopens what ADR-0017 rejected — orchestration wiring in
  `project.json` that must be kept in sync. The mitigation is that the wiring
  is `dependsOn` edges, not a bespoke script, and that the plain-dependency
  promise is untouched: `pnpm install` alone still produces working bindings.

## Evidence

- `libs/isekai/wasm-bridge/project.json`,
  `libs/domains/procgen/generation-wasm/project.json`, and
  `libs/domains/procgen/discretize/project.json` declare the `build` target.
- `nx run architecture-studio:check` in a worktree with nothing pre-generated
  runs `engine-domain-core:generate`, all three Wasm builds, and `ui:build`
  before `tsc`, and hits the cache on a second run.

## Migration or rollback

No consumer code changes; this is build wiring only.

Rollback removes the `build` targets and the `dependsOn` entries that name
them, returning to ADR-0017 unamended. It must not remove the
`engine-domain-core:generate` edges, which fix a defect that predates this
decision and are independent of it.
