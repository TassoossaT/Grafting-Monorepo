//! Wasm bridge exposing `grafting-graph-core`'s construction operations and
//! the terrain-generation crate's pure generators as one stateful
//! `ConstructionSession` for the Web host. Pure wiring only -- see this
//! crate's `AGENTS.md` for the boundary this crate must not cross.
//!
mod editing;
mod contour_query;
mod enclosure;
mod field_query;
mod footprint;
mod geometry;
mod grid_generation;
mod mesh;
mod patch_replacement;
mod pins;
mod region_editing;
mod panel_runs;
mod region_annotations;
mod region_props;
mod region_overlay;
mod session;
#[cfg(test)]
mod pin_tests;
#[cfg(test)]
mod host_trace_tests;
#[cfg(test)]
mod profile_cap_tests;
#[cfg(test)]
mod run_tests;
#[cfg(test)]
mod session_cost_probe;
#[cfg(test)]
mod session_tests;
pub(crate) mod spatial_index;
#[cfg(test)]
mod test_support;

pub use session::ConstructionSession;
