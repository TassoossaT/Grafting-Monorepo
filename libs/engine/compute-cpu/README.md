# `engine-compute-cpu` (`grafting-compute-cpu`)

Synchronous CPU reference implementation of the `compute-api` job
contract. See `GRAFTING_MASTER_SOURCE.md` S4.2, S23 E-002.

## Current status

E-002 done: `CpuBackend` implements `ComputeBackend` from
`engine-compute-api` synchronously -- `submit` computes immediately and
stores a terminal state (`Completed`/`Failed`). 8 tests, all passing:
capabilities reporting, immediate completion, correct scaling, empty
input (no panic), non-finite `factor` (fails the job, doesn't panic),
unknown-handle rejection, double-release rejection, and
operations-after-release rejection.

Deliberately not done, and why:

- **`Pending`/`Running`/`Cancelled` are unreachable in this backend.**
  They're real parts of the *shared* `JobState` contract that an async
  backend (`compute-wgpu`, E-005, not built yet) will actually exercise —
  not simulated here just to reach 100% enum coverage.
- **CPU-vs-GPU differential testing is structurally unreachable** (S4.2
  assigns this to `compute-cpu`; it's also E-009's job) — there is no
  `compute-wgpu` to differentiate against yet. "Correct baseline" (E-002's
  literal criterion) means the CPU math is right on its own, not that it
  has been cross-validated against a GPU implementation.
- **`ScaleF32` is a structural placeholder**, not E-003's pilot workload
  — see `engine-compute-api`'s `README.md`/`src/lib.rs`.

## Targets

- `check` -- `cargo check -p grafting-compute-cpu`
- `test` -- `cargo test -p grafting-compute-cpu`

Run via Nx: `nx run engine-compute-cpu:test`.
