//! Wasm bridge exposing `grafting-graph-core`'s construction operations and
//! the terrain-generation crate's pure generators as one stateful
//! `ConstructionSession` for the Web host. Pure wiring only -- see this
//! crate's `AGENTS.md` for the boundary this crate must not cross.
//!
mod editing;
mod enclosure;
mod footprint;
mod geometry;
mod grid_generation;
mod mesh;
mod patch_replacement;
mod region_editing;
mod region_overlay;
mod session;
#[cfg(test)]
mod profile_cap_tests;
#[cfg(test)]
mod session_cost_probe;
#[cfg(test)]
mod session_tests;
pub(crate) mod spatial_index;

pub use session::ConstructionSession;
