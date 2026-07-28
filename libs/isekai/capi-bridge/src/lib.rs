//! Versioned C ABI exposing `grafting-domain-core` to native hosts
//! (master source S4.2). `extern "C"` exports, generational kind-tagged
//! handles, `catch_unwind` at every boundary, fixed-width status codes.
//! Never exposes `Vec`/`String`/trait objects/Rust enums without a fixed
//! representation across the boundary (S11.2).
//!
//! # Scope of this v1 (D-001..D-006)
//!
//! Exposes exactly **one** concretely-typed real operation,
//! `engine_submit_increment`, instead of S11.6's fully generic
//! `engine_submit(bytes, length)`. A generic entry point would need a
//! byte layout for `Command`/`DomainEvent` -- both are named for
//! FlatBuffers by master source S10.1 (`DEC-013`, `LOCKED`), which isn't
//! wired up yet (`flatc`, C-005/C-006, still blocked). Building even a
//! "temporary" hand-rolled codec for them would repeat a mistake already
//! made and reverted once in this repo (`domain-core`'s `Snapshot`, which
//! briefly used `serde_json` before the same reasoning reverted it -- see
//! `libs/engine/domain-core/src/snapshot.rs`). The generic byte-oriented
//! `engine_submit` arrives once C-005/C-006 land.
//!
//! `isekai-wasm`/`isekai-web-client` (D-007/D-008) and the memory test
//! (D-009) are a separate task -- different surface (Wasm/wasm-bindgen
//! vs. this crate's native cdylib/P-Invoke).

pub mod abi_info;
pub mod buffer;
pub mod engine;
pub mod handle;
pub mod job;
pub mod status;
