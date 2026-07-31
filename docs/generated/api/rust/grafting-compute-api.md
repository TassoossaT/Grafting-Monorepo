# grafting-compute-api

### `pub enum grafting_compute_api::ComputeError`

### `pub enum grafting_compute_api::ComputeOp`

One batched numeric operation. Payloads are raw `Vec<f32>` (hot
numeric path, master source S10.1) -- never FlatBuffers-wrapped;
FlatBuffers is for structured messages (Commands/DomainEvents/
Snapshots), a separate, `LOCKED` concern (DEC-013).

### `pub enum grafting_compute_api::ComputeResult`

### `pub enum grafting_compute_api::JobState`

Job lifecycle (master source S12.4's `Pending → Running → Completed`/
`Failed`/`Cancelled` vocabulary, applied to compute jobs). A
synchronous backend may only ever produce `Completed`/`Failed`
directly from `submit` -- `Pending`/`Running`/`Cancelled` are real
parts of this *shared* contract that an async backend (`compute-wgpu`,
not built yet) will actually exercise.

### `pub fn grafting_compute_api::ComputeBackend::capabilities(&self) -> grafting_compute_api::ComputeCapabilities`

### `pub fn grafting_compute_api::ComputeBackend::poll(&mut self, job: grafting_compute_api::JobHandle) -> core::result::Result<grafting_compute_api::JobState, grafting_compute_api::ComputeError>`

### `pub fn grafting_compute_api::ComputeBackend::release(&mut self, job: grafting_compute_api::JobHandle) -> core::result::Result<(), grafting_compute_api::ComputeError>`

### `pub fn grafting_compute_api::ComputeBackend::submit(&mut self, plan: grafting_compute_api::ComputePlan) -> grafting_compute_api::JobHandle`

### `pub fn grafting_compute_api::ComputeBackend::take_result(&mut self, job: grafting_compute_api::JobHandle) -> core::result::Result<grafting_compute_api::ComputeResult, grafting_compute_api::ComputeError>`

### `pub grafting_compute_api::ComputeCapabilities::backend_name: &'static str`

### `pub grafting_compute_api::ComputeCapabilities::supports_gpu: bool`

### `pub grafting_compute_api::ComputeError::JobFailed`

The job reached `Failed`; carries the same reason.

### `pub grafting_compute_api::ComputeError::JobFailed::reason: alloc::string::String`

### `pub grafting_compute_api::ComputeError::JobNotComplete`

`take_result` was called before the job reached a terminal state.

### `pub grafting_compute_api::ComputeError::JobNotComplete::state: grafting_compute_api::JobState`

### `pub grafting_compute_api::ComputeError::UnknownJob`

The handle was never issued, or has already been released.

### `pub grafting_compute_api::ComputeOp::ScaleF32`

### `pub grafting_compute_api::ComputeOp::ScaleF32::factor: f32`

### `pub grafting_compute_api::ComputeOp::ScaleF32::input: alloc::vec::Vec<f32>`

### `pub grafting_compute_api::ComputePlan::op: grafting_compute_api::ComputeOp`

### `pub grafting_compute_api::ComputeResult::F32(alloc::vec::Vec<f32>)`

### `pub grafting_compute_api::JobState::Cancelled`

### `pub grafting_compute_api::JobState::Completed`

### `pub grafting_compute_api::JobState::Failed`

### `pub grafting_compute_api::JobState::Failed::reason: alloc::string::String`

### `pub grafting_compute_api::JobState::Pending`

### `pub grafting_compute_api::JobState::Running`

### `pub mod grafting_compute_api`

Backend-agnostic compute job contract (master source S4.2, S13.6):
job types, capabilities, and the [`ComputeBackend`] trait every
backend (CPU now, `wgpu` later) implements. Must not depend on or
expose concrete `wgpu` types (E-001's literal acceptance criterion,
S23) -- this crate has zero dependencies.

# `ScaleF32`: a structural placeholder, not the pilot workload

[`ComputeOp::ScaleF32`] exists only to prove the batch/job contract
shape end to end. It is **not** E-003's "pilot workload" -- that
backlog item (dataset and metric defined) remains unselected pending a
real product decision; nothing in the project docs specifies one yet.
The earlier accepted spike (`spikes/wgpu-native-web/shared/double.wgsl`)
already proved this exact family of operation (element-wise scale)
runs identically on native and Web `wgpu`. That bit-identical result
is a property of trivial power-of-2 scaling, **not** evidence that GPU
float compute is bit-deterministic in general -- master source S13.7
lists bit-for-bit-determinism-requiring logic as a *bad* GPU
candidate, and `docs/adr/ADR-0004-determinism.md` forbids relying on
GPU bit-exactness.

# Deliberately not modeled yet: resident problem state

S13.6's full conceptual `ComputeBackend` also has
`upload_problem`/`release_problem` (a `ProblemHandle`) for *resident*
GPU state (S13.4: "the model is loaded; matrices/vectors persist ...
each iteration sends only parameters/deltas"). That's Phase 7 solver
territory. A stateless per-plan op like `ScaleF32` has nothing
resident to manage; adding a `ProblemHandle` that does nothing would
be a fake abstraction, not a real one -- left out on purpose.

# Handle scheme: intentionally not generational

Master source S11.3's *generational* handles (index+generation, `0`
invalid) are scoped to the FFI/C-ABI boundary (`isekai-capi`, Epic D).
[`JobHandle`] never crosses `extern "C"` -- a monotonic `u64`, rejected
via lookup once released, is enough here. `isekai-capi` will *wrap*,
not reuse, this scheme later.

### `pub struct grafting_compute_api::ComputeCapabilities`

What a [`ComputeBackend`] can do -- consulted before submitting work
(e.g. to decide `PowerPreference`-style tradeoffs once a GPU backend
exists).

### `pub struct grafting_compute_api::ComputePlan`

### `pub struct grafting_compute_api::JobHandle(pub u64)`

Opaque handle to a submitted job. Monotonic, not generational -- see
the crate-level docs for why that's the right call here.

### `pub trait grafting_compute_api::ComputeBackend`

Implemented once per backend (CPU now; `wgpu` later, once a real pilot
workload -- E-003 -- picks something worth accelerating).
