//! Generic geometry primitives behind `ADR-0022` construction surfaces:
//! extruding a path into vertical panels, capping a closed boundary, and
//! finding regions/boundaries in a set of grid cells. No product concept
//! (wall, door, room, terrain cell) is known here -- see
//! `docs/adr/ADR-0022-wall-representation-free-geometry.md`'s "Structure
//! clouds and the generation/orchestration split."
//!
//! This crate produces plain data only -- new nodes, new edges, and
//! [`grafting_graph_core::SurfaceSpec`]s -- and never mutates a
//! [`grafting_graph_core::Graph`] or [`grafting_graph_core::SurfaceRegistry`]
//! itself. Applying that data to a live graph, whether as a first creation
//! or as an edit against prior state, is a caller concern.

#![deny(missing_docs)]

mod boundary;
mod extrusion;
mod ids;
mod region_partition;

pub use boundary::cap_boundary;
pub use extrusion::{ArcBulge, EdgeCurvature, EdgeNotch, ExtrusionError, PathEdge, StructurePiece, extrude_path};
pub use region_partition::{Axis, BoundaryRun, CellCoord, Region, boundary_runs, partition_cells_into_regions};
