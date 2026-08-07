# Threads and asynchrony

Relocated verbatim from `GRAFTING_MASTER_SOURCE.md` section 14 on 2026-08-07, as the
router table in that document's S0.4 had scheduled. The section numbering is
preserved because `S<n>.<n>` is the stable citation key used from real source
comments and manifests; those citations resolve here now, unchanged.
Precedence and normative language remain in `GRAFTING_MASTER_SOURCE.md`
section 0 and govern everything below.

---

## 14. Threads and asynchrony

### 14.1 Web

Main thread:

- React/UI;
- Three.js;
- input;
- presentation;
- frame loop.

Worker:

- Wasm instance;
- simulation state;
- `wgpu` compute;
- jobs;
- protocol decode/encode;
- optionally WebSocket in a future phase.

Rules:

- do not block the main thread;
- do not use busy polling;
- communicate via messages;
- transfer `ArrayBuffer` when ownership can change;
- do not introduce `SharedArrayBuffer` in V1;
- handle Worker termination and crash.

### 14.2 Desktop

The C# host must not run heavy jobs on the UI/render thread.

Model:

- C# submits;
- Rust schedules;
- GPU/worker executes;
- C# receives completion;
- the result is consumed at a safe point in the frame.

Do not call `device.poll(Wait)` on the main thread.

### 14.3 Readback

GPU readback must use:

- staging buffer;
- submission;
- callback/future;
- buffer pool;
- short signaling;
- later consumption.

While a buffer is mapped by the CPU, it must not be used simultaneously by the GPU.

Reference:

- [https://docs.rs/wgpu/latest/wgpu/struct.CommandBuffer.html](https://docs.rs/wgpu/latest/wgpu/struct.CommandBuffer.html)
