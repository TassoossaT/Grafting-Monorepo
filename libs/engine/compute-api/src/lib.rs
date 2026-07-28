//! Backend-agnostic compute job contract (master source S4.2, S13.6):
//! job types, capabilities, and the [`ComputeBackend`] trait every
//! backend (CPU now, `wgpu` later) implements. Must not depend on or
//! expose concrete `wgpu` types (E-001's literal acceptance criterion,
//! S23) -- this crate has zero dependencies.
//!
//! # `ScaleF32`: a structural placeholder, not the pilot workload
//!
//! [`ComputeOp::ScaleF32`] exists only to prove the batch/job contract
//! shape end to end. It is **not** E-003's "pilot workload" -- that
//! backlog item (dataset and metric defined) remains unselected pending a
//! real product decision; nothing in the project docs specifies one yet.
//! The earlier accepted spike (`spikes/wgpu-native-web/shared/double.wgsl`)
//! already proved this exact family of operation (element-wise scale)
//! runs identically on native and Web `wgpu`. That bit-identical result
//! is a property of trivial power-of-2 scaling, **not** evidence that GPU
//! float compute is bit-deterministic in general -- master source S13.7
//! lists bit-for-bit-determinism-requiring logic as a *bad* GPU
//! candidate, and `docs/adr/ADR-0004-determinism.md` forbids relying on
//! GPU bit-exactness.
//!
//! # Deliberately not modeled yet: resident problem state
//!
//! S13.6's full conceptual `ComputeBackend` also has
//! `upload_problem`/`release_problem` (a `ProblemHandle`) for *resident*
//! GPU state (S13.4: "the model is loaded; matrices/vectors persist ...
//! each iteration sends only parameters/deltas"). That's Phase 7 solver
//! territory. A stateless per-plan op like `ScaleF32` has nothing
//! resident to manage; adding a `ProblemHandle` that does nothing would
//! be a fake abstraction, not a real one -- left out on purpose.
//!
//! # Handle scheme: intentionally not generational
//!
//! Master source S11.3's *generational* handles (index+generation, `0`
//! invalid) are scoped to the FFI/C-ABI boundary (`isekai-capi`, Epic D).
//! [`JobHandle`] never crosses `extern "C"` -- a monotonic `u64`, rejected
//! via lookup once released, is enough here. `isekai-capi` will *wrap*,
//! not reuse, this scheme later.

/// What a [`ComputeBackend`] can do -- consulted before submitting work
/// (e.g. to decide `PowerPreference`-style tradeoffs once a GPU backend
/// exists).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ComputeCapabilities {
    pub backend_name: &'static str,
    pub supports_gpu: bool,
}

/// Opaque handle to a submitted job. Monotonic, not generational -- see
/// the crate-level docs for why that's the right call here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct JobHandle(pub u64);

/// Job lifecycle (master source S12.4's `Pending → Running → Completed`/
/// `Failed`/`Cancelled` vocabulary, applied to compute jobs). A
/// synchronous backend may only ever produce `Completed`/`Failed`
/// directly from `submit` -- `Pending`/`Running`/`Cancelled` are real
/// parts of this *shared* contract that an async backend (`compute-wgpu`,
/// not built yet) will actually exercise.
#[derive(Debug, Clone, PartialEq)]
pub enum JobState {
    Pending,
    Running,
    Completed,
    Failed { reason: String },
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ComputeError {
    /// The handle was never issued, or has already been released.
    UnknownJob,
    /// `take_result` was called before the job reached a terminal state.
    JobNotComplete { state: JobState },
    /// The job reached `Failed`; carries the same reason.
    JobFailed { reason: String },
}

/// One batched numeric operation. Payloads are raw `Vec<f32>` (hot
/// numeric path, master source S10.1) -- never FlatBuffers-wrapped;
/// FlatBuffers is for structured messages (Commands/DomainEvents/
/// Snapshots), a separate, `LOCKED` concern (DEC-013).
#[derive(Debug, Clone, PartialEq)]
pub enum ComputeOp {
    ScaleF32 { input: Vec<f32>, factor: f32 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ComputePlan {
    pub op: ComputeOp,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ComputeResult {
    F32(Vec<f32>),
}

/// Implemented once per backend (CPU now; `wgpu` later, once a real pilot
/// workload -- E-003 -- picks something worth accelerating).
pub trait ComputeBackend {
    fn capabilities(&self) -> ComputeCapabilities;
    fn submit(&mut self, plan: ComputePlan) -> JobHandle;
    fn poll(&mut self, job: JobHandle) -> Result<JobState, ComputeError>;
    fn take_result(&mut self, job: JobHandle) -> Result<ComputeResult, ComputeError>;
    fn release(&mut self, job: JobHandle) -> Result<(), ComputeError>;
}
