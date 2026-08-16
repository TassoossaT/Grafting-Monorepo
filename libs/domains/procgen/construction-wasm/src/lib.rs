//! Wasm bridge exposing `grafting-graph-core`'s construction operations and
//! the terrain-generation/structure-generation crates' pure generators as
//! one stateful `ConstructionSession` for the Web host. Pure wiring only --
//! see this crate's `AGENTS.md` for the boundary this crate must not cross.
//!
mod dto;
mod editing;
mod mesh;
mod room_addition;
mod room_grid;
mod room_removal;
mod session;
mod terrain;
mod wall;

pub use session::ConstructionSession;
