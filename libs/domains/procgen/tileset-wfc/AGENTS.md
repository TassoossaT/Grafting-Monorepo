# AGENTS.md -- `grafting-procgen-tileset-wfc`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

## The rule that defines this crate

**No third-party solver type may appear outside `src/backend/`.** Not in a
public signature, not in `lib.rs`, not in a consumer's imports, not in a test
outside `tests/backend_*.rs`. The constraint engine is expected to change --
to another crate, to our own implementation, to a maintained fork of
`ghx_proc_gen` -- and the whole point of this crate's shape is that such a
change touches one module plus one cargo feature and nothing else in the
repository.

Concretely, when adding or changing a backend:

- put it in `src/backend/<name>.rs` behind a `solver-<name>` feature;
- implement `solver::ConstraintSolver`, taking `Problem` and returning
  `Assignment`, translating in and out inside that module;
- do not widen `Problem` or `Assignment` to suit one engine. If a backend
  needs something the model lacks, add it as a general concept with a general
  justification, not as a passthrough.

`cargo check -p grafting-procgen-tileset-wfc --no-default-features` must keep
succeeding, and `tests/model.rs` must keep passing with no backend enabled.
That is the executable form of the rule above: if the domain ever stops
building without a solver, the seam has leaked. Both are Nx targets
(`check-no-backend`, `test-no-backend`) -- do not delete them as redundant.

## What belongs here and what does not

This crate assigns modules to cells of an arbitrary graph under socket
constraints. It has no concept of terrain, elevation, water, meshes, or
rendering, and must not acquire one -- the same way
`libs/domains/procgen/discretize` operates on an arbitrary continuous signal
rather than on heightmaps. A terrain tileset, the mapping from a quad grid to
a `CellGraph`, and the deformation of a module's mesh onto an irregular quad
are all *consumer* concerns.

Lives under `libs/domains/procgen` per DEC-046 (`GRAFTING_MASTER_SOURCE.md`
§4.4): a generic, shareable domain capability. Dungeon rooms and interior
furniture are the same capability with a different tileset, and must be served
by this crate rather than by a copy of it.

## Known sharp edges

- **Proving unsatisfiability is not bounded.** A backend handed a
  contradictory problem may search for a very long time rather than fail
  fast; a complete graph of 6 cells with 3 mutually-exclusive modules was
  measured at over 7 minutes. `Problem::compile` rejects the cheap cases (a
  cell with no candidates, a link with no compatible pair) precisely so that
  the common authoring mistakes become errors instead of hangs. It cannot
  catch every case, and no cheap check can. Treat a slow solve as a suspected
  contradiction.
- **Panics are not catchable on `wasm32-unknown-unknown`**, the constraint
  the sibling procgen crates' own `AGENTS.md` files already document. Validate
  at the boundary; return `Result`, never panic on caller input.
- **`uuid` is declared for `wasm32` only, and nothing here imports it.** It
  reaches us through `wave-function-collapse` and refuses to build for that
  target without an explicit randomness source; the declaration exists purely
  so Cargo's feature unification supplies one. If the `solver-wfc` backend is
  ever removed, remove that declaration with it.
