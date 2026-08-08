# `tileset-wfc` (`grafting-procgen-tileset-wfc`)

Picks one module per cell of an arbitrary graph such that neighbouring modules
fit. This is the generic capability behind a Townscaper-style terrain pass, but
it knows nothing about terrain -- dungeon rooms and interior furniture are the
same capability with a different tileset.

Born under `libs/domains/procgen` per `GRAFTING_MASTER_SOURCE.md` §4.4
(DEC-046), like its siblings `generation-wasm` and `discretize`.

## Status

The constraint model, generated orientations, one backend, and a
`wasm_bindgen` boundary, with tests. There is still no terrain tileset here,
and there should not be: a tileset is a consumer's content, not this crate's.

## The solver is behind a seam, on purpose

Callers depend on `ConstraintSolver`, `Problem`, and `Assignment` -- all ours.
**No third-party type appears in any public signature.** A backend lives in one
module behind one cargo feature, so switching engines touches that module and
the feature, and nothing else in the repository.

That this holds is checked rather than asserted: the crate builds and
`tests/model.rs` passes with `--no-default-features`, i.e. with no solver at
all, and one of those tests implements `ConstraintSolver` from outside the
crate using only public types. If the domain ever stops building without a
backend, the seam has leaked.

## Why not `ghx_proc_gen`, which the research chose first

Its solver requires that the neighbour of `n` in direction `d` has `n` as its
neighbour in the opposite direction, with direction indices fixed globally.
Our irregular quad grid provably admits no such labelling -- interior vertices
of valence other than four obstruct it, measured at 58--93 irreducible
contradictions per grid against zero on a regular control. A workable encoding
does exist (directions as ordered face pairs), but `ghx_proc_gen` 0.8.0 exposes
no public way to build its `Rules` for a coordinate system we define, so it
would have required an upstream change or a fork.

`wave-function-collapse` declares constraints per neighbour pair with no
direction concept at all, so the irregular graph is native rather than
worked around. It was measured before adoption: deterministic from a seed,
varied across seeds, contradictions reported as errors, compiles to
`wasm32-unknown-unknown`, and roughly 7 ms for 225 cells.

See `docs/research/vtt-map-and-terrain-construction-options.md` for the full
comparison.

## Shape of a run

1. `CellGraph` -- who neighbours whom, across which face. Faces are local to
   their cell, which is what lets an irregular grid be described at all.
2. `Tileset` -- modules, each declaring a socket per face, plus which sockets
   may meet. Adding a mesh means declaring its sockets, not relating it to
   every existing mesh.
3. `Problem::compile` -- expands sockets into per-link module pairs, and
   rejects the cheap unsatisfiable cases while it can still name the cell or
   link at fault.
4. `solve_verified` -- runs a backend, then checks the answer against the
   problem. Worth doing even against a trusted backend, since not trusting the
   backend is the point of a swappable one.

Cells absent from `pinned` may take any module; pinning is how an earlier
pipeline stage imposes what it already decided.

## Orientations are generated, not authored

A rotation here is a permutation of *face indices*, not a transform of
geometry -- this crate never sees geometry. `Tileset::rotated` takes a cycle of
faces and expands each module into its distinct orientations, so on a stacked
quad grid the four lateral faces rotate among themselves while up and down do
not rotate at all.

Two properties make it safe to switch on without thinking:

- **Symmetry is detected, not declared.** Flat ground yields one variant and a
  corner yields four, because a turn that leaves the sockets unchanged is
  dropped. Nobody annotates anything.
- **Weight belongs to the module, not the variant.** The weight is divided
  across the orientations produced, so making a piece asymmetric does not
  silently make it four times as common.

`Tileset::origin` (and `Problem::origins`, carried across the wasm boundary)
maps a result back: which authored module's mesh, spun how far.

## The Web boundary

`src/wasm.rs` exposes `solveTileset`, a flat typed-array ABI: counts, links,
sockets, weights, socket compatibility, a rotation cycle, pins and a seed in;
per cell the chosen variant, the authored module and the number of turns out.
Everything crossing is a number, so replacing the solver changes no
JavaScript. Its body is `solve_inner`, a plain `Result<_, String>`, so the
bridge is covered by a native test rather than only in a browser.

Consumed as `@grafting/procgen-tileset-wfc` (`workspace:*`); `pkg/` is
`wasm-pack` output and gitignored, per DEC-055/ADR-0017.

## Targets

- `build` -- `wasm-pack`, producing `pkg/`
- `check` / `test` -- with the default backend
- `check-no-backend` / `test-no-backend` -- the seam, enforced

Run via Nx: `nx run tileset-wfc:test`, `nx run tileset-wfc:test-no-backend`.
