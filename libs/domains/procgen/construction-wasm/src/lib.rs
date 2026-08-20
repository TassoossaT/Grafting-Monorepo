//! Wasm bridge exposing `grafting-graph-core`'s construction operations and
//! the terrain-generation/structure-generation crates' pure generators as
//! one stateful `ConstructionSession` for the Web host. Pure wiring only --
//! see this crate's `AGENTS.md` for the boundary this crate must not cross.
//!
mod diff_apply;
mod dto;
mod editing;
mod generation;
mod geometry;
mod mesh;
mod path_brush;
mod region_editing;
mod region_merge;
mod session;
mod terrain;

pub use session::ConstructionSession;
