# AGENTS.md -- `engine-compute-api`

Scope-local addendum to the root `AGENTS.md`. Root rules still apply.

This crate defines the compute contract only (master source S4.2). It
MUST NOT depend on `wgpu` or expose any concrete `wgpu` type -- that
would collapse the CPU/GPU backend boundary E-001 exists to keep. It MUST
NOT contain domain logic (that's `domain-core`) or Worker/Wasm
orchestration (that's `isekai-web-client`, a later package).

`ComputeOp::ScaleF32` is a structural placeholder, not a product
decision. Do not add a "real" workload-specific op here without an
explicit E-003 decision (dataset and metric defined) first -- see
`README.md`.
