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

pub mod buffer;
pub mod engine;
pub mod handle;
pub mod job;

pub use engine::WasmEngine;
pub use job::JobStateCode;
