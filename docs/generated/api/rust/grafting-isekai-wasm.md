# grafting-isekai-wasm

### `impl<T> core::default::Default for grafting_isekai_wasm::handle::HandleTable<T>`

### `impl<T> core::marker::Freeze for grafting_isekai_wasm::handle::HandleTable<T>`

### `impl<T> core::marker::Send for grafting_isekai_wasm::handle::HandleTable<T> where T: core::marker::Send`

### `impl<T> core::marker::Sync for grafting_isekai_wasm::handle::HandleTable<T> where T: core::marker::Sync`

### `impl<T> core::marker::Unpin for grafting_isekai_wasm::handle::HandleTable<T> where T: core::marker::Unpin`

### `impl<T> core::panic::unwind_safe::RefUnwindSafe for grafting_isekai_wasm::handle::HandleTable<T> where T: core::panic::unwind_safe::RefUnwindSafe`

### `impl<T> core::panic::unwind_safe::UnwindSafe for grafting_isekai_wasm::handle::HandleTable<T> where T: core::panic::unwind_safe::UnwindSafe`

### `impl<T> grafting_isekai_wasm::handle::HandleTable<T>`

### `pub enum grafting_isekai_wasm::JobStateCode`

The JS-facing state code. `wasm-bindgen` exposes a plain C-style enum
like this directly as a JS enum-like object.

### `pub enum grafting_isekai_wasm::job::JobState`

Rust-internal job state. Carries the failure reason for potential
future use; not exposed across to JS (see [`JobStateCode`]).

### `pub enum grafting_isekai_wasm::job::JobStateCode`

The JS-facing state code. `wasm-bindgen` exposes a plain C-style enum
like this directly as a JS enum-like object.

### `pub fn grafting_isekai_wasm::buffer::BufferRecord::new(data: alloc::vec::Vec<u8>) -> Self`

### `pub fn grafting_isekai_wasm::debug_memory() -> wasm_bindgen::JsValue`

Test-only (D-009): the module's `WebAssembly.Memory` instance, so a
caller can read `buffer.byteLength` directly. Wasm linear memory
pages obtained via `memory.grow` are never returned to the browser
even after Rust frees the objects that grew them -- the logical
handle-table counts (`WasmEngine::debug_job_count` etc.) can prove
there's no *handle* leak, but only this can speak to §19.5's literal
"`memory.grow`" item (does linear memory plateau under repetition,
not just the bookkeeping on top of it).

### `pub fn grafting_isekai_wasm::engine::WasmEngine::buffer_release(&mut self, buffer: u64) -> core::result::Result<(), wasm_bindgen::JsValue>`

### `pub fn grafting_isekai_wasm::engine::WasmEngine::buffer_view(&self, buffer: u64) -> core::result::Result<alloc::vec::Vec<u8>, wasm_bindgen::JsValue>`

Returns a fresh copy of the buffer's bytes (a `Vec<u8>` crossing
out of Wasm always copies into a new `Uint8Array` -- there is no
zero-copy view out of linear memory across this specific boundary
the way native pointer views work).

### `pub fn grafting_isekai_wasm::engine::WasmEngine::debug_buffer_count(&self) -> usize`

Test-only (D-009): same as [`Self::debug_job_count`] for buffers.

### `pub fn grafting_isekai_wasm::engine::WasmEngine::debug_buffer_slot_count(&self) -> usize`

Test-only (D-009): same as [`Self::debug_job_slot_count`] for
buffers.

### `pub fn grafting_isekai_wasm::engine::WasmEngine::debug_job_count(&self) -> usize`

Test-only (D-009): outstanding job count (`HandleTable::len`) --
exists so a caller can observe whether the job table stays bounded
under repeated submit/release cycles instead of only inferring it
from correctness.

### `pub fn grafting_isekai_wasm::engine::WasmEngine::debug_job_slot_count(&self) -> usize`

Test-only (D-009): the job table's total slot count
(`HandleTable::slot_count`) -- catches "arena growth" (a broken
free-slot-reuse scan) that a flat [`Self::debug_job_count`] alone
would miss.

### `pub fn grafting_isekai_wasm::engine::WasmEngine::debug_trigger_panic(&mut self)`

Test-only: deliberately panics (after real mutation, matching the
scratch probe that established this module's panic-handling
design) to exercise `wasm-bindgen`'s per-object poisoning. Always
traps -- there is no normal return.

### `pub fn grafting_isekai_wasm::engine::WasmEngine::describe()`

### `pub fn grafting_isekai_wasm::engine::WasmEngine::describe_vector()`

### `pub fn grafting_isekai_wasm::engine::WasmEngine::into_abi(self) -> Self::Abi`

### `pub fn grafting_isekai_wasm::engine::WasmEngine::is_none(abi: &Self::Abi) -> bool`

### `pub fn grafting_isekai_wasm::engine::WasmEngine::job_release(&mut self, job: u64) -> core::result::Result<(), wasm_bindgen::JsValue>`

### `pub fn grafting_isekai_wasm::engine::WasmEngine::new(seed: alloc::vec::Vec<u8>) -> core::result::Result<grafting_isekai_wasm::engine::WasmEngine, wasm_bindgen::JsValue>`

`seed` must be exactly 32 bytes -- caller-visible and
caller-controlled on purpose (DEC-044), same as the native side's
`EngineCreateInfo.seed`.

### `pub fn grafting_isekai_wasm::engine::WasmEngine::none() -> Self::Abi`

### `pub fn grafting_isekai_wasm::engine::WasmEngine::poll(&self, job: u64) -> core::result::Result<grafting_isekai_wasm::job::JobStateCode, wasm_bindgen::JsValue>`

### `pub fn grafting_isekai_wasm::engine::WasmEngine::shutdown(&mut self)`

Idempotent: shutting down an already-`ShuttingDown`/`Destroyed`
engine is not an error.

### `pub fn grafting_isekai_wasm::engine::WasmEngine::submit_increment(&mut self, amount: i64) -> core::result::Result<u64, wasm_bindgen::JsValue>`

The one real operation this v1 exposes (same scoping rationale as
`isekai-capi-bridge::engine::engine_submit_increment`: a generic
Command/DomainEvent channel needs a wire format DEC-013 locks to
FlatBuffers, not built yet). Returns `Err` only for "engine not
Ready" -- a validation failure inside the command (e.g. overflow)
is a normal `Ok` job handle whose job ends up `Failed`, never a
thrown exception. A thrown exception from *this* function is
reserved for lifecycle misuse, not for genuine panics (which, per
the module docs, can't be caught here at all).

### `pub fn grafting_isekai_wasm::engine::WasmEngine::take_result(&mut self, job: u64) -> core::result::Result<u64, wasm_bindgen::JsValue>`

Moves a completed job's result bytes into a new buffer lease.
Fails for any non-`Completed` state, including `Failed` -- this v1
doesn't cross the failure reason to JS (mirrors the native side).

### `pub fn grafting_isekai_wasm::engine::WasmEngine::try_from_js_value(value: wasm_bindgen::JsValue) -> core::result::Result<Self, wasm_bindgen::JsValue>`

### `pub fn grafting_isekai_wasm::engine::WasmEngine::try_from_js_value_ref(value: &wasm_bindgen::JsValue) -> core::option::Option<Self>`

### `pub fn grafting_isekai_wasm::engine::WasmEngine::vector_into_abi(vector: alloc::boxed::Box<[grafting_isekai_wasm::engine::WasmEngine]>) -> Self::Abi`

### `pub fn grafting_isekai_wasm::handle::HandleTable<T>::default() -> Self`

### `pub fn grafting_isekai_wasm::handle::HandleTable<T>::get(&self, raw: u64) -> core::option::Option<&T>`

### `pub fn grafting_isekai_wasm::handle::HandleTable<T>::get_mut(&mut self, raw: u64) -> core::option::Option<&mut T>`

### `pub fn grafting_isekai_wasm::handle::HandleTable<T>::insert(&mut self, value: T) -> u64`

Generation starts at 1 so the packed handle is never 0.

### `pub fn grafting_isekai_wasm::handle::HandleTable<T>::len(&self) -> usize`

Occupied slots right now -- see
`capi-bridge/src/handle.rs::HandleTable::len`'s doc comment for
why this alone isn't sufficient "no leak" evidence (D-009); pair
with [`Self::slot_count`].

### `pub fn grafting_isekai_wasm::handle::HandleTable<T>::new() -> Self`

### `pub fn grafting_isekai_wasm::handle::HandleTable<T>::remove(&mut self, raw: u64) -> core::option::Option<T>`

Bumping the generation on removal means a stale (already-released)
handle is rejected even after the slot is reused (S11.3).

### `pub fn grafting_isekai_wasm::handle::HandleTable<T>::slot_count(&self) -> usize`

Total slots ever allocated (this table's own high-water mark) --
catches "arena growth" (D-009, S19.5) that a flat [`Self::len`]
alone would miss.

### `pub fn grafting_isekai_wasm::job::JobRecord::completed(bytes: alloc::vec::Vec<u8>) -> Self`

### `pub fn grafting_isekai_wasm::job::JobRecord::failed(reason: alloc::string::String) -> Self`

### `pub fn grafting_isekai_wasm::job::JobStateCode::describe()`

### `pub fn grafting_isekai_wasm::job::JobStateCode::describe_vector()`

### `pub fn grafting_isekai_wasm::job::JobStateCode::from(state: &grafting_isekai_wasm::job::JobState) -> Self`

### `pub fn grafting_isekai_wasm::job::JobStateCode::into_abi(self) -> u32`

### `pub fn grafting_isekai_wasm::job::JobStateCode::is_none(val: &Self::Abi) -> bool`

### `pub fn grafting_isekai_wasm::job::JobStateCode::none() -> Self::Abi`

### `pub fn grafting_isekai_wasm::job::JobStateCode::try_from_js_value_ref(value: &wasm_bindgen::JsValue) -> core::option::Option<Self>`

### `pub fn grafting_isekai_wasm::job::JobStateCode::vector_into_abi(vector: alloc::boxed::Box<[grafting_isekai_wasm::job::JobStateCode]>) -> Self::Abi`

### `pub fn grafting_isekai_wasm::layout_graph_json(request_json: &str) -> core::result::Result<alloc::string::String, wasm_bindgen::JsValue>`

Calculates one immutable grouped-grid snapshot from a batched JSON request.

JSON is an adapter-owned ABI representation. Callers should use a typed
Grafting client and must not treat this serialization shape as graph logic.

### `pub fn wasm_bindgen::JsValue::from(value: grafting_isekai_wasm::engine::WasmEngine) -> Self`

### `pub fn wasm_bindgen::JsValue::from(value: grafting_isekai_wasm::job::JobStateCode) -> Self`

### `pub grafting_isekai_wasm::JobStateCode::Cancelled`

### `pub grafting_isekai_wasm::JobStateCode::Completed`

### `pub grafting_isekai_wasm::JobStateCode::Failed`

### `pub grafting_isekai_wasm::JobStateCode::Pending`

### `pub grafting_isekai_wasm::JobStateCode::Running`

### `pub grafting_isekai_wasm::buffer::BufferRecord::data: alloc::vec::Vec<u8>`

### `pub grafting_isekai_wasm::job::JobRecord::result: core::option::Option<alloc::vec::Vec<u8>>`

`Some` only while `state == Completed` and the result hasn't been
taken yet (`take_result` moves it into a buffer).

### `pub grafting_isekai_wasm::job::JobRecord::state: grafting_isekai_wasm::job::JobState`

### `pub grafting_isekai_wasm::job::JobState::Cancelled`

### `pub grafting_isekai_wasm::job::JobState::Completed`

### `pub grafting_isekai_wasm::job::JobState::Failed`

### `pub grafting_isekai_wasm::job::JobState::Failed::reason: alloc::string::String`

### `pub grafting_isekai_wasm::job::JobState::Pending`

### `pub grafting_isekai_wasm::job::JobState::Running`

### `pub grafting_isekai_wasm::job::JobStateCode::Cancelled`

### `pub grafting_isekai_wasm::job::JobStateCode::Completed`

### `pub grafting_isekai_wasm::job::JobStateCode::Failed`

### `pub grafting_isekai_wasm::job::JobStateCode::Pending`

### `pub grafting_isekai_wasm::job::JobStateCode::Running`

### `pub mod grafting_isekai_wasm`

Wasm bridge exposing `grafting-domain-core` to the Web host, for use
inside a Dedicated Worker (DEC-015). Web-side mirror of
`grafting-isekai-capi` -- see `engine.rs`'s module docs for the
empirically-verified panic-handling difference between the two.

Exposes exactly one concretely-typed real operation
(`WasmEngine::submit_increment`), not a generic Command/DomainEvent
channel -- same reasoning as `isekai-capi-bridge`: those two types are
named for FlatBuffers by master source S10.1 (DEC-013, `LOCKED`),
which isn't wired up yet (C-005/C-006, blocked on B-004).

### `pub mod grafting_isekai_wasm::buffer`

A job's result bytes, held behind a handle (master source S12.4:
`OwnedByRust → ViewLeased → OwnedByRust → Released`). `view()` is
idempotent (repeatable) rather than gated on a strict "already leased"
state -- same reasoning as `libs/isekai/capi-bridge/src/buffer.rs`.

### `pub mod grafting_isekai_wasm::engine`

`WasmEngine`: one `domain_core::State` + one seeded RNG, exposed as a
`wasm-bindgen` class (master source S4.2's `isekai-wasm`
responsibilities: adapting linear memory, exposing numeric handles,
converting errors into stable structures, never duplicating domain
rules). Web-side mirror of `isekai-capi-bridge::engine`'s
`EngineHandle` + `engine_submit_increment`.

# Panic handling is fundamentally different from the native side --
empirically verified, not assumed

`std::panic::catch_unwind` does **not** catch a panic on
`wasm32-unknown-unknown` (verified: it traps as `unreachable`,
surfacing to JS as an uncaught `RuntimeError`, even with
`panic = "unwind"` set). So unlike `isekai-capi-bridge::engine`, there
is **no explicit `Poisoned` lifecycle variant here** -- Rust never
gets to run code after the trap to set one.

What actually happens instead (verified with real heap-allocating
work -- `Vec` push/grow, `String::format`, matching
`apply_command`/`state_hash`'s real shape -- in both Node and a real
headless-browser session): `wasm-bindgen`'s own runtime borrow guard
marks the *specific* panicking `WasmEngine` instance as permanently
unusable (`recursive use of an object detected` on any further call),
while every other `WasmEngine` instance, all other heap allocations,
and the ability to allocate *new* heap memory all remain completely
unaffected. This is a real, per-object failure mode, not a global one
-- `isekai-web-client` (the JS/TS layer) is what classifies "this
specific engine is now dead" by catching the exception; there is
nothing for Rust itself to track. (This appears to contradict
`wasm-bindgen`'s own "hard abort" docs and a Cloudflare Workers
postmortem describing instance-wide poisoning -- most likely those
describe a different failure category, e.g. `panic = "abort"`'s
default or an older `wasm-bindgen` version. Re-verify with the same
method -- two independent stateful instances, real heap allocation,
one deliberately panicked -- before trusting this design if
`wasm-bindgen` is ever upgraded.)

### `pub mod grafting_isekai_wasm::handle`

Generational handles for `Job`/`Buffer` (master source S11.3: `0` is
invalid; index+generation prevent trivial use-after-free; duplicate
release returns an error).

`Engine` itself is **not** tracked here -- it's a `wasm-bindgen` class
instance (`engine.rs`), which is the idiomatic Wasm-side handle and
where per-object panic poisoning naturally applies (see `engine.rs`'s
module docs for the empirical finding this is based on). This table
only needs one kind (`Job` and `Buffer` each get their own table
instance), so unlike `isekai-capi-bridge`'s `handle::HandleTable`
there is no kind tag to pack -- callers never mix a `Job` handle from
one engine with a `Buffer` handle from another table by construction
(each `WasmEngine` owns its own two tables).

This is intentionally near-identical to
`libs/isekai/capi-bridge/src/handle.rs`'s generic logic, duplicated
rather than shared -- ~150 lines, mechanical, low-risk to duplicate
once. A good candidate for extraction into a shared crate once a third
consumer needs the same table, not done preemptively.

### `pub mod grafting_isekai_wasm::job`

Job lifecycle (master source S12.4), mirroring
`libs/isekai/capi-bridge/src/job.rs`'s design for the Wasm side.

### `pub struct grafting_isekai_wasm::WasmEngine`

### `pub struct grafting_isekai_wasm::buffer::BufferRecord`

### `pub struct grafting_isekai_wasm::engine::WasmEngine`

### `pub struct grafting_isekai_wasm::handle::HandleTable<T>`

### `pub struct grafting_isekai_wasm::job::JobRecord`

### `pub type grafting_isekai_wasm::engine::WasmEngine::Abi = <alloc::boxed::Box<[wasm_bindgen::JsValue]> as wasm_bindgen::convert::traits::FromWasmAbi>::Abi`

### `pub type grafting_isekai_wasm::engine::WasmEngine::Abi = <alloc::boxed::Box<[wasm_bindgen::JsValue]> as wasm_bindgen::convert::traits::IntoWasmAbi>::Abi`

### `pub type grafting_isekai_wasm::engine::WasmEngine::Abi = wasm_bindgen::__rt::WasmPtr<wasm_bindgen::__rt::WasmRefCell<grafting_isekai_wasm::engine::WasmEngine>>`

### `pub type grafting_isekai_wasm::engine::WasmEngine::Anchor = wasm_bindgen::__rt::RcRef<grafting_isekai_wasm::engine::WasmEngine>`

### `pub type grafting_isekai_wasm::engine::WasmEngine::Anchor = wasm_bindgen::__rt::RcRefMut<grafting_isekai_wasm::engine::WasmEngine>`

### `pub type grafting_isekai_wasm::job::JobStateCode::Abi = <alloc::boxed::Box<[wasm_bindgen::JsValue]> as wasm_bindgen::convert::traits::FromWasmAbi>::Abi`

### `pub type grafting_isekai_wasm::job::JobStateCode::Abi = <alloc::boxed::Box<[wasm_bindgen::JsValue]> as wasm_bindgen::convert::traits::IntoWasmAbi>::Abi`

### `pub type grafting_isekai_wasm::job::JobStateCode::Abi = u32`

### `pub unsafe fn grafting_isekai_wasm::engine::WasmEngine::from_abi(js: Self::Abi) -> Self`

### `pub unsafe fn grafting_isekai_wasm::engine::WasmEngine::long_ref_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_isekai_wasm::engine::WasmEngine::ref_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_isekai_wasm::engine::WasmEngine::ref_mut_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_isekai_wasm::engine::WasmEngine::vector_from_abi(js: Self::Abi) -> alloc::boxed::Box<[grafting_isekai_wasm::engine::WasmEngine]>`

### `pub unsafe fn grafting_isekai_wasm::job::JobStateCode::from_abi(js: u32) -> Self`

### `pub unsafe fn grafting_isekai_wasm::job::JobStateCode::vector_from_abi(js: Self::Abi) -> alloc::boxed::Box<[grafting_isekai_wasm::job::JobStateCode]>`
