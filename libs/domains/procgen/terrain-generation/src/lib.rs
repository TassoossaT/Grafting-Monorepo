//! Derives `ADR-0022` construction-surface node cycles from a WFC-chosen
//! terrain module and a [`grafting_graph_core::PrismGridMesh`] cell.
//!
//! This crate produces plain data only -- new nodes, new edges, and a
//! [`grafting_graph_core::SurfaceSpec`] -- and never mutates a
//! [`grafting_graph_core::Graph`] or [`grafting_graph_core::SurfaceRegistry`]
//! itself. Applying that data to a live graph, whether as a first creation
//! or as an edit against prior state, is a caller concern.

#![deny(missing_docs)]

mod bilinear;
mod generate;
mod module;

pub use bilinear::bilinear_point;
pub use generate::{TerrainCellGeneration, TerrainGenerationError, generate_terrain_cell_surface};
pub use module::{CornerHeightModule, rotate_corner_heights};
