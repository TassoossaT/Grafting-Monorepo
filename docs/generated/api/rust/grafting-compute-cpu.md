# grafting-compute-cpu

### `pub fn grafting_compute_cpu::CpuBackend::capabilities(&self) -> grafting_compute_api::ComputeCapabilities`

### `pub fn grafting_compute_cpu::CpuBackend::new() -> Self`

### `pub fn grafting_compute_cpu::CpuBackend::poll(&mut self, job: grafting_compute_api::JobHandle) -> core::result::Result<grafting_compute_api::JobState, grafting_compute_api::ComputeError>`

### `pub fn grafting_compute_cpu::CpuBackend::release(&mut self, job: grafting_compute_api::JobHandle) -> core::result::Result<(), grafting_compute_api::ComputeError>`

### `pub fn grafting_compute_cpu::CpuBackend::submit(&mut self, plan: grafting_compute_api::ComputePlan) -> grafting_compute_api::JobHandle`

### `pub fn grafting_compute_cpu::CpuBackend::take_result(&mut self, job: grafting_compute_api::JobHandle) -> core::result::Result<grafting_compute_api::ComputeResult, grafting_compute_api::ComputeError>`

### `pub mod grafting_compute_cpu`

Synchronous CPU reference implementation of the `compute-api` job
contract (master source S4.2, S23 E-002: "correct baseline").

`submit` computes immediately and stores a terminal state
(`Completed`/`Failed`) -- there is no async work here to observe
`Pending`/`Running`/`Cancelled` mid-flight. Those remain real variants
of the *shared* `JobState` contract that an async backend
(`compute-wgpu`, not built yet) will actually exercise; this backend
only ever produces them at the seams (`take_result` before
completion), which is unreachable by construction in a synchronous
implementation -- documented here rather than silently absent.

CPU-vs-GPU differential testing (S4.2's `compute-cpu` responsibility;
E-009) is structurally unreachable until `compute-wgpu` (E-005)
exists -- an open gap, not something "correct baseline" implies is
covered.

### `pub struct grafting_compute_cpu::CpuBackend`
