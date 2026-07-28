# AGENTS.md -- `engine-compute-cpu`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This crate is the reference (CPU) implementation of `compute-api`'s
`ComputeBackend` trait (master source S4.2). It MUST NOT depend on `wgpu`
-- it exists specifically to give `compute-wgpu` (future) something
correct to be validated against (differential testing, E-009), which
requires this crate to stay GPU-free.

Do not add a "real" workload-specific operation here without the
corresponding E-003 decision landing in `engine-compute-api` first --
this crate only implements whatever ops the contract defines.
