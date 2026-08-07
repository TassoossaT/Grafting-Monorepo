# GPU and the single solver

Relocated verbatim from `GRAFTING_MASTER_SOURCE.md` section 13 on 2026-08-07, as the
router table in that document's S0.4 had scheduled. The section numbering is
preserved because `S<n>.<n>` is the stable citation key used from real source
comments and manifests; those citations resolve here now, unchanged.
Precedence and normative language remain in `GRAFTING_MASTER_SOURCE.md`
section 0 and govern everything below.

---

## 13. GPU and the single solver

### 13.1 Ownership

Closed rule:

> Rust is the sole owner of GPU resources for mathematical computation. Three.js and the C# engine own the rendering resources.

This produces:

- one solver;
- one Rust dispatcher;
- one WGSL collection;
- two distribution formats;
- separate logical devices when the renderer also uses GPU.

### 13.2 The same backend on Web and Desktop

`wgpu` runs:

- natively on Vulkan, Metal, D3D12, and OpenGL;
- on Wasm over WebGPU or WebGL2.

General compute requires WebGPU; WebGL2 must not be treated as an equivalent fallback for compute. When WebGPU is unavailable, the CPU backend must take over.

Reference:

- [https://github.com/gfx-rs/wgpu](https://github.com/gfx-rs/wgpu)

### 13.3 Backend contents

`compute-wgpu` must control:

- `Instance`;
- `Adapter`;
- `Device`;
- `Queue`;
- shader modules;
- bind groups;
- compute pipelines;
- persistent buffers;
- staging buffers;
- ring buffers;
- submission IDs;
- readback pool;
- device loss.

### 13.4 Resident data

For a future solver:

1. the model is loaded;
2. matrices and vectors persist on the GPU;
3. each iteration sends only parameters/deltas;
4. multiple kernels are chained;
5. readback occurs only for scalars or the final solution;
6. the solution is validated on the CPU.

Avoid:

```text
upload matrix → dispatch → readback matrix
```

on every iteration.

### 13.5 Solver versus kernel division

Rust:

- modeling;
- search policy;
- macro control of iterations;
- stopping criteria;
- memory management;
- scheduling;
- validation.

WGSL:

- parallel evaluation;
- matvec;
- reductions;
- scoring;
- constraint evaluation;
- vector update;
- dense or massively parallel operations.

`wgpu` does not automatically turn a regular Rust function into a compute shader. WGSL kernels are the single source for GPU.

### 13.6 Async jobs

Conceptual internal API:

```rust
trait ComputeBackend {
    fn capabilities(&self) -> ComputeCapabilities;
    fn upload_problem(&mut self, problem: &ProblemData) -> ProblemHandle;
    fn submit(&mut self, plan: ComputePlan) -> JobHandle;
    fn poll(&mut self, job: JobHandle) -> JobState;
    fn take_result(&mut self, job: JobHandle) -> Result<ComputeResult, ComputeError>;
    fn release_problem(&mut self, problem: ProblemHandle);
}
```

Avoid one FFI call per numeric operation. `ComputePlan` must represent a batch large enough to amortize dispatch.

### 13.7 Suitable workloads

Good candidates:

- thousands of independent evaluations;
- linear algebra;
- distance fields;
- AI scoring;
- relaxations;
- reduction of large vectors;
- offline generation;
- a solver with resident state and compact response.

Bad candidates:

- business rules;
- highly branched and small flows;
- tasks smaller than the upload cost;
- logic that requires bit-for-bit determinism;
- huge output consumed by the renderer every frame.

### 13.8 Limit of device separation

If Rust computes millions of positions that Three.js needs to render every frame:

```text
Rust GPU → CPU → renderer GPU
```

the readback/upload can dominate.

In that case, a future ADR will choose between:

1. running the visual compute in the renderer;
2. moving rendering to Rust;
3. implementing external-memory interop per backend.

Do not generalize this exception to pathfinding, AI, or a solver with compact output.
