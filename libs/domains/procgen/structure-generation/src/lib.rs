//! Derives `ADR-0022` construction-surface node cycles for walls and door
//! openings from centerline generation parameters.
//!
//! This crate produces plain data only -- new nodes, new edges, and
//! [`grafting_graph_core::SurfaceSpec`]s -- and never mutates a
//! [`grafting_graph_core::Graph`] or [`grafting_graph_core::SurfaceRegistry`]
//! itself. Applying that data to a live graph, whether as a first creation
//! or as an edit against prior state, is a caller concern.

#![deny(missing_docs)]

mod rect_tiling;
mod room_grid;
mod wall;

pub use rect_tiling::{RectTile, generate_tiled_rooms};
pub use room_grid::{RoomGridGeneration, RoomGridLayout, generate_room_grid};
pub use wall::{
    DoorOpening, StructureGenerationError, StructurePiece, WallGeneration, WallNodeRole,
    WallSegment, generate_wall,
};
