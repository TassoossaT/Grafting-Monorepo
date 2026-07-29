//! Wasm bridge exposing `grafting-domain-core` to the Web host, for use
//! inside a Dedicated Worker (DEC-015). Web-side mirror of
//! `grafting-isekai-capi` -- see `engine.rs`'s module docs for the
//! empirically-verified panic-handling difference between the two.
//!
//! Exposes exactly one concretely-typed real operation
//! (`WasmEngine::submit_increment`), not a generic Command/DomainEvent
//! channel -- same reasoning as `isekai-capi-bridge`: those two types are
//! named for FlatBuffers by master source S10.1 (DEC-013, `LOCKED`),
//! which isn't wired up yet (C-005/C-006, blocked on B-004).

use wasm_bindgen::prelude::*;

pub mod buffer;
pub mod engine;
pub mod handle;
pub mod job;

pub use engine::WasmEngine;
pub use job::JobStateCode;

/// Test-only (D-009): the module's `WebAssembly.Memory` instance, so a
/// caller can read `buffer.byteLength` directly. Wasm linear memory
/// pages obtained via `memory.grow` are never returned to the browser
/// even after Rust frees the objects that grew them -- the logical
/// handle-table counts (`WasmEngine::debug_job_count` etc.) can prove
/// there's no *handle* leak, but only this can speak to §19.5's literal
/// "`memory.grow`" item (does linear memory plateau under repetition,
/// not just the bookkeeping on top of it).
#[wasm_bindgen]
pub fn debug_memory() -> JsValue {
    wasm_bindgen::memory()
}
