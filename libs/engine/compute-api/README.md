# `engine-compute-api` (`grafting-compute-api`)

Backend-agnostic compute job contract: capabilities, job lifecycle, and
the `ComputeBackend` trait. See `GRAFTING_MASTER_SOURCE.md` S4.2, S13.6.

## Current status

E-001 done: `ComputeCapabilities`, `JobHandle`, `JobState`, `ComputeError`,
`ComputeOp`/`ComputePlan`/`ComputeResult`, and the `ComputeBackend` trait.
Zero dependencies -- satisfies both "must not expose concrete `wgpu`
types" (S4.2) and E-001's literal criterion, "domain does not depend on
`wgpu`."

`ComputeOp::ScaleF32` is a **structural placeholder proving the contract
shape**, not E-003's pilot workload -- see the crate-level doc comment in
`src/lib.rs` for the full reasoning (it deliberately does not claim the
earlier GPU spike's bit-identical result generalizes to GPU float
determinism at large).

Deliberately not modeled yet, and why:

- **No `ProblemHandle`/resident state** (S13.6's `upload_problem`/
  `release_problem`) -- that's for Phase 7 solver workloads with
  persistent GPU-resident data. A stateless per-plan op has nothing
  resident to manage.
- **No generational handles** -- `JobHandle` never crosses FFI
  (`isekai-capi`, Epic D, will wrap this, not reuse it). See `src/lib.rs`.

## Targets

- `check` -- `cargo check -p grafting-compute-api`
- `test` -- `cargo test -p grafting-compute-api` (thin contract crate;
  the substantive tests live in `engine-compute-cpu`, the first real
  implementation)

Run via Nx: `nx run engine-compute-api:check`.
