# grafting-isekai-capi

### `#[no_mangle] pub c fn grafting_isekai_capi::engine::engine_buffer_release(engine: u64, buffer: u64) -> grafting_isekai_capi::status::EngineStatus`

### `#[no_mangle] pub c fn grafting_isekai_capi::engine::engine_debug_trigger_panic(engine: u64) -> grafting_isekai_capi::status::EngineStatus`

Test-only hook: deliberately panics inside a live engine to exercise
the `Poisoned` path (mirrors `spikes/rust-capi-dotnet`'s
`spike_capi_trigger_panic`, now producing real, persistent poisoning
instead of transient mutex-poison recovery).

### `#[no_mangle] pub c fn grafting_isekai_capi::engine::engine_destroy(engine: u64) -> grafting_isekai_capi::status::EngineStatus`

Removing the handle bumps its generation (`handle::HandleTable`), so a
second `engine_destroy` with the same raw handle correctly returns
`InvalidHandle` (D-002's "double-release tested").

### `#[no_mangle] pub c fn grafting_isekai_capi::engine::engine_job_release(engine: u64, job: u64) -> grafting_isekai_capi::status::EngineStatus`

### `#[no_mangle] pub c fn grafting_isekai_capi::engine::engine_shutdown(engine: u64) -> grafting_isekai_capi::status::EngineStatus`

Idempotent (S12.6): shutting down an already-`ShuttingDown`/
`Destroyed`/`Poisoned` engine is not an error.

### `#[no_mangle] pub unsafe c fn grafting_isekai_capi::abi_info::engine_get_abi_info(out_info: *mut grafting_isekai_capi::abi_info::EngineAbiInfo) -> grafting_isekai_capi::status::EngineStatus`

Reports this build's ABI so the host can decide compatibility before
calling anything else (S12.3: "the C# wrapper validates this at
startup").

# Safety
`out_info` must be a valid, writable `EngineAbiInfo*`.

### `#[no_mangle] pub unsafe c fn grafting_isekai_capi::engine::engine_buffer_view(engine: u64, buffer: u64, out_data: *mut *const u8, out_length: *mut u64) -> grafting_isekai_capi::status::EngineStatus`

# Safety
`out_data`/`out_length` must be valid, writable pointers. The returned
`*out_data` is valid only until `engine_buffer_release` is called for
this handle -- callers must not retain it past that point.

### `#[no_mangle] pub unsafe c fn grafting_isekai_capi::engine::engine_create(create_info: *const grafting_isekai_capi::engine::EngineCreateInfo, out_engine: *mut u64) -> grafting_isekai_capi::status::EngineStatus`

# Safety
`create_info` and `out_engine` must be valid pointers of their
documented types; `create_info` must be readable, `out_engine` writable.

### `#[no_mangle] pub unsafe c fn grafting_isekai_capi::engine::engine_debug_buffer_count(engine: u64, out_count: *mut u64) -> grafting_isekai_capi::status::EngineStatus`

Test-only hook (D-009): same as [`engine_debug_job_count`] for the
buffer table.

# Safety
`out_count` must be a valid, writable `u64*`.

### `#[no_mangle] pub unsafe c fn grafting_isekai_capi::engine::engine_debug_job_count(engine: u64, out_count: *mut u64) -> grafting_isekai_capi::status::EngineStatus`

Test-only hook (D-009): the engine's current outstanding job count
(`HandleTable::len`, i.e. inserted-but-not-yet-released). Exists so a
caller (e.g. a .NET `SafeHandle` finalizer test) has a way to observe
whether a handle was *really* released rather than inferring it only
from "nothing else broke."

# Safety
`out_count` must be a valid, writable `u64*`.

### `#[no_mangle] pub unsafe c fn grafting_isekai_capi::engine::engine_job_poll(engine: u64, job: u64, out_state: *mut grafting_isekai_capi::job::JobStateCode) -> grafting_isekai_capi::status::EngineStatus`

# Safety
`out_state` must be a valid, writable `JobStateCode*`.

### `#[no_mangle] pub unsafe c fn grafting_isekai_capi::engine::engine_job_take_result(engine: u64, job: u64, out_buffer: *mut u64) -> grafting_isekai_capi::status::EngineStatus`

Moves a completed job's result bytes into a new buffer lease. Fails
with `JobNotComplete` for any non-`Completed` state, including
`Failed` -- this v1 doesn't cross the failure reason over the ABI
(S11.2: no `String`).

# Safety
`out_buffer` must be a valid, writable `u64*`.

### `#[no_mangle] pub unsafe c fn grafting_isekai_capi::engine::engine_submit_increment(engine: u64, amount: i64, out_job: *mut u64) -> grafting_isekai_capi::status::EngineStatus`

The one real operation this v1 exposes -- see crate-level docs for why
this is concretely typed rather than a generic byte-oriented
`engine_submit`.

# Safety
`out_job` must be a valid, writable `u64*`.

### `#[repr(C)] pub struct grafting_isekai_capi::abi_info::EngineAbiInfo`

Every public struct begins with `struct_size` (S12.2) so callers can
tell an `ABI_MINOR` field-appending change apart from a real mismatch.

### `#[repr(C)] pub struct grafting_isekai_capi::engine::EngineCreateInfo`

S12.2: every public struct begins with `struct_size`. Carries an
explicit RNG seed (correction from design review: defaulting it
inside Rust would hide state the host can't reproduce or control,
cutting against DEC-044's replay-determinism claim -- `Snapshot.rng_seed`
is already treated as essential, caller-visible state in `domain-core`).

### `#[repr(i32)] pub enum grafting_isekai_capi::job::JobStateCode`

The FFI-facing state code (`#[repr(i32)]`, fixed-width, S11.2) --
deliberately smaller than [`JobState`]: no failure-reason string
crosses the boundary in this v1.

### `#[repr(i32)] pub enum grafting_isekai_capi::status::EngineStatus`

`#[repr(i32)]` so the C header sees a plain, fixed-width enum -- never
a bare Rust enum without a fixed representation (S11.2).

### `#[repr(u8)] pub enum grafting_isekai_capi::handle::HandleKind`

### `impl<T> core::marker::Freeze for grafting_isekai_capi::handle::HandleTable<T>`

### `impl<T> core::marker::Send for grafting_isekai_capi::handle::HandleTable<T> where T: core::marker::Send`

### `impl<T> core::marker::Sync for grafting_isekai_capi::handle::HandleTable<T> where T: core::marker::Sync`

### `impl<T> core::marker::Unpin for grafting_isekai_capi::handle::HandleTable<T> where T: core::marker::Unpin`

### `impl<T> core::panic::unwind_safe::RefUnwindSafe for grafting_isekai_capi::handle::HandleTable<T> where T: core::panic::unwind_safe::RefUnwindSafe`

### `impl<T> core::panic::unwind_safe::UnwindSafe for grafting_isekai_capi::handle::HandleTable<T> where T: core::panic::unwind_safe::UnwindSafe`

### `impl<T> grafting_isekai_capi::handle::HandleTable<T>`

### `pub const grafting_isekai_capi::abi_info::ABI_MAJOR: u32`

### `pub const grafting_isekai_capi::abi_info::ABI_MINOR: u32`

### `pub const grafting_isekai_capi::abi_info::FEATURE_CPU_BACKEND: u32`

### `pub const grafting_isekai_capi::abi_info::FEATURE_GPU_BACKEND: u32`

### `pub enum grafting_isekai_capi::engine::EngineLifecycle`

### `pub enum grafting_isekai_capi::job::JobState`

Rust-internal job state. Carries the failure reason for future use;
not yet exposed across the ABI (see [`JobStateCode`], which cannot
carry a `String` per S11.2).

### `pub fn grafting_isekai_capi::abi_info::EngineAbiInfo::current() -> Self`

`pub`, not `pub(crate)`: a `#[repr(C)]` value return, not an ABI
boundary crossing -- also called from `src/bin/abi_info_cli.rs`
(technically a separate crate within this package, per Cargo's
own bin/lib split) so tooling reads this real runtime value
(G-004) instead of duplicating its logic by re-deriving it.

### `pub fn grafting_isekai_capi::buffer::BufferRecord::new(data: alloc::vec::Vec<u8>) -> Self`

### `pub fn grafting_isekai_capi::handle::HandleTable<T>::get(&self, raw: u64) -> core::option::Option<&T>`

### `pub fn grafting_isekai_capi::handle::HandleTable<T>::get_mut(&mut self, raw: u64) -> core::option::Option<&mut T>`

### `pub fn grafting_isekai_capi::handle::HandleTable<T>::insert(&mut self, value: T) -> u64`

Generation starts at 1 so the packed handle is never 0.

### `pub fn grafting_isekai_capi::handle::HandleTable<T>::len(&self) -> usize`

Occupied slots right now. A table that's always balanced (one
`insert` per `remove`) should hold this flat across repeated
cycles (D-009's "no leak" signal) -- but flat `len()` alone can't
tell "leak-free" apart from a broken free-slot-reuse scan that
leaves this table's own bookkeeping growing regardless; pair with
[`Self::slot_count`] for that.

### `pub fn grafting_isekai_capi::handle::HandleTable<T>::new(kind: grafting_isekai_capi::handle::HandleKind) -> Self`

### `pub fn grafting_isekai_capi::handle::HandleTable<T>::remove(&mut self, raw: u64) -> core::option::Option<T>`

Bumping the generation on removal means a stale (already-released)
handle is rejected even after the slot is reused (S11.3).

### `pub fn grafting_isekai_capi::handle::HandleTable<T>::slot_count(&self) -> usize`

Total slots ever allocated (this table's own high-water mark),
distinct from [`Self::len`]'s occupied count -- catches "arena
growth" (D-009, S19.5): a table whose `insert()` stopped reusing
freed slots would still show a flat `len()` every cycle (each
cycle still calls `remove()` correctly) while this number climbs
unboundedly.

### `pub fn grafting_isekai_capi::job::JobRecord::completed(bytes: alloc::vec::Vec<u8>) -> Self`

### `pub fn grafting_isekai_capi::job::JobRecord::failed(reason: alloc::string::String) -> Self`

### `pub fn grafting_isekai_capi::job::JobStateCode::from(state: &grafting_isekai_capi::job::JobState) -> Self`

### `pub grafting_isekai_capi::abi_info::EngineAbiInfo::abi_major: u32`

### `pub grafting_isekai_capi::abi_info::EngineAbiInfo::abi_minor: u32`

### `pub grafting_isekai_capi::abi_info::EngineAbiInfo::feature_flags: u32`

Bitmask of `FEATURE_*` constants. Both bits are meaningful today:
CPU is always set (`compute-cpu` exists); GPU is always clear (no
`compute-wgpu` yet).

### `pub grafting_isekai_capi::abi_info::EngineAbiInfo::protocol_version: u32`

No wire protocol exists yet (that needs C-005/C-006); fixed at 0.

### `pub grafting_isekai_capi::abi_info::EngineAbiInfo::struct_size: u32`

### `pub grafting_isekai_capi::buffer::BufferRecord::data: alloc::vec::Vec<u8>`

### `pub grafting_isekai_capi::engine::EngineCreateInfo::seed: [u8; 32]`

### `pub grafting_isekai_capi::engine::EngineCreateInfo::struct_size: u32`

### `pub grafting_isekai_capi::engine::EngineLifecycle::Creating`

Real state in the shared vocabulary; unreachable in this v1 since
engine creation has no async initialization work (no GPU device,
no multiplayer handshake) -- `engine_create` goes straight to
`Ready`.

### `pub grafting_isekai_capi::engine::EngineLifecycle::Destroyed`

### `pub grafting_isekai_capi::engine::EngineLifecycle::Poisoned`

### `pub grafting_isekai_capi::engine::EngineLifecycle::Ready`

### `pub grafting_isekai_capi::engine::EngineLifecycle::ShuttingDown`

### `pub grafting_isekai_capi::handle::HandleKind::Buffer = 3`

### `pub grafting_isekai_capi::handle::HandleKind::Engine = 1`

### `pub grafting_isekai_capi::handle::HandleKind::Job = 2`

### `pub grafting_isekai_capi::job::JobRecord::result: core::option::Option<alloc::vec::Vec<u8>>`

`Some` only while `state == Completed` and the result hasn't been
taken yet (`engine_job_take_result` moves it into a buffer).

### `pub grafting_isekai_capi::job::JobRecord::state: grafting_isekai_capi::job::JobState`

### `pub grafting_isekai_capi::job::JobState::Cancelled`

### `pub grafting_isekai_capi::job::JobState::Completed`

### `pub grafting_isekai_capi::job::JobState::Failed`

### `pub grafting_isekai_capi::job::JobState::Failed::reason: alloc::string::String`

### `pub grafting_isekai_capi::job::JobState::Pending`

### `pub grafting_isekai_capi::job::JobState::Running`

### `pub grafting_isekai_capi::job::JobStateCode::Cancelled = 4`

### `pub grafting_isekai_capi::job::JobStateCode::Completed = 2`

### `pub grafting_isekai_capi::job::JobStateCode::Failed = 3`

### `pub grafting_isekai_capi::job::JobStateCode::Pending = 0`

### `pub grafting_isekai_capi::job::JobStateCode::Running = 1`

### `pub grafting_isekai_capi::status::EngineStatus::EngineNotReady = -3`

### `pub grafting_isekai_capi::status::EngineStatus::InternalPanic = -5`

### `pub grafting_isekai_capi::status::EngineStatus::InvalidHandle = -2`

### `pub grafting_isekai_capi::status::EngineStatus::JobNotComplete = -6`

### `pub grafting_isekai_capi::status::EngineStatus::NullPointer = -1`

### `pub grafting_isekai_capi::status::EngineStatus::Ok = 0`

### `pub grafting_isekai_capi::status::EngineStatus::Poisoned = -4`

### `pub grafting_isekai_capi::status::EngineStatus::StructSizeMismatch = -7`

### `pub mod grafting_isekai_capi`

Versioned C ABI exposing `grafting-domain-core` to native hosts
(master source S4.2). `extern "C"` exports, generational kind-tagged
handles, `catch_unwind` at every boundary, fixed-width status codes.
Never exposes `Vec`/`String`/trait objects/Rust enums without a fixed
representation across the boundary (S11.2).

# Scope of this v1 (D-001..D-006)

Exposes exactly **one** concretely-typed real operation,
`engine_submit_increment`, instead of S11.6's fully generic
`engine_submit(bytes, length)`. A generic entry point would need a
byte layout for `Command`/`DomainEvent` -- both are named for
FlatBuffers by master source S10.1 (`DEC-013`, `LOCKED`), which isn't
wired up yet (`flatc`, C-005/C-006, still blocked). Building even a
"temporary" hand-rolled codec for them would repeat a mistake already
made and reverted once in this repo (`domain-core`'s `Snapshot`, which
briefly used `serde_json` before the same reasoning reverted it -- see
`libs/engine/domain-core/src/snapshot.rs`). The generic byte-oriented
`engine_submit` arrives once C-005/C-006 land.

`isekai-wasm`/`isekai-web-client` (D-007/D-008) and the memory test
(D-009) are a separate task -- different surface (Wasm/wasm-bindgen
vs. this crate's native cdylib/P-Invoke).

### `pub mod grafting_isekai_capi::abi_info`

Capability negotiation (master source S12.3), scoped down from the
section's full field list (build ID, target, async-support signaling)
-- no build pipeline produces a build ID yet and no cross-target
matrix exists. This is a deliberately smaller v1, documented as such,
not silently implied complete.

### `pub mod grafting_isekai_capi::buffer`

A leased view over a job's result bytes (master source S12.4:
`OwnedByRust → ViewLeased → OwnedByRust → Released`). `engine_buffer_view`
is idempotent (repeatable, always returns the same pointer/length)
rather than gating on a strict "already leased" state -- S11.6's
conceptual API has no separate "end view" function, so there is
nothing for a stricter state machine to transition back through
before `engine_buffer_release`.

### `pub mod grafting_isekai_capi::engine`

Engine lifecycle (master source S12.4: `Creating → Ready →
ShuttingDown → Destroyed`, plus `→ Poisoned → Destroyed`) and the one
real operation this v1 exposes, `engine_submit_increment` (see the
crate-level docs for why this isn't the fully generic
`engine_submit(bytes)` from S11.6).

# Panic handling (S12.5)

Only the actual domain-logic call (`apply_command`) is wrapped in
`catch_unwind`, while the registry `MutexGuard` is held in an *outer*
scope the panic never unwinds through -- so the registry mutex itself
is never poisoned by a domain-logic panic. On a caught panic, the
specific engine's `lifecycle` is set to `Poisoned` **explicitly** and
every subsequent call on that handle is refused before touching
`state`/`rng` again. This is deliberately not the mutex-poison
recover-and-continue shortcut `spikes/rust-capi-dotnet` used (that
spike's own README already flags it as "not the intended production
design") -- S12.5: "do not continue simulating in a doubtful state."

### `pub mod grafting_isekai_capi::handle`

Generational, kind-tagged opaque handles (master source S11.3: `0` is
invalid; index+generation prevent trivial use-after-free; "the
logical type is validated"; duplicate release returns an error).

Packed into one `u64`: `[8 bits kind][24 bits generation][32 bits index]`.
The kind tag isn't decorative: two independently-generationed tables
(one per handle kind) could otherwise produce the *same* raw `u64` for
an `Engine` and a `Job` handle, so passing one where the other is
expected would silently misvalidate instead of failing cleanly. The
tag prevents that structurally.

`ProblemHandle` (S11.3's fourth kind) is intentionally not modeled --
same call as Epic E's `ProblemHandle` deferral: no resident GPU/solver
state exists yet to hand a handle to.

### `pub mod grafting_isekai_capi::job`

Job lifecycle (master source S12.4: `Pending → Running → Completed`/
`Failed`/`Cancelled → Released`), applied to `engine_submit_increment`.
`engine_submit_increment` computes synchronously (same pattern as
`engine-compute-cpu`'s `CpuBackend`) and stores a terminal state
immediately -- `Pending`/`Running`/`Cancelled` are real parts of this
*shared* lifecycle vocabulary, not reachable from this synchronous v1
(documented, not silently absent -- same honesty pattern as
`compute-cpu`'s README).

### `pub mod grafting_isekai_capi::status`

Status codes crossing the ABI (master source S11.2: fixed-width types
only; S21.2: every export returns a status, never unwinds).

### `pub struct grafting_isekai_capi::buffer::BufferRecord`

### `pub struct grafting_isekai_capi::handle::HandleTable<T>`

A generational registry for exactly one [`HandleKind`]. `Engine`/
`Job`/`Buffer` registries are each a separate `HandleTable`.

### `pub struct grafting_isekai_capi::job::JobRecord`
