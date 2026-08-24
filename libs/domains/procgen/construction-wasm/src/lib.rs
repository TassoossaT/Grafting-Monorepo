//! Wasm bridge exposing `grafting-graph-core`'s construction operations and
//! the terrain-generation/structure-generation crates' pure generators as
//! one stateful `ConstructionSession` for the Web host. Pure wiring only --
//! see this crate's `AGENTS.md` for the boundary this crate must not cross.
//!
mod diff_apply;
mod dto;
mod editing;
mod enclosure;
mod footprint;
mod generation;
mod geometry;
mod mesh;
mod patch_replacement;
mod region_editing;
mod region_overlay;
mod session;
#[cfg(test)]
mod session_tests;

pub use session::ConstructionSession;
