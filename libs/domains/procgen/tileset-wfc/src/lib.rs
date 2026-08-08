//! Tile assignment over an arbitrary cell graph.
//!
//! Given cells, what is adjacent to what, and a set of modules declaring which
//! sockets they expose, this picks one module per cell such that neighbouring
//! modules fit. It is the generic capability behind a Townscaper-style terrain
//! pass, but knows nothing about terrain, elevation, or meshes -- a caller
//! that wants dungeon rooms or interior furniture uses the same crate with a
//! different tileset.
//!
//! # Why the solver is behind a trait
//!
//! The constraint engine is expected to change. Callers therefore depend on
//! [`solver::ConstraintSolver`] and on this crate's own types; no third-party
//! type appears in any public signature here. A backend lives in one module
//! behind one cargo feature ([`backend`]), so switching engines -- to another
//! crate, to our own implementation, to a maintained fork -- touches that
//! module and the feature, and nothing else in the repository.
//!
//! # Shape of a run
//!
//! 1. [`graph::CellGraph`] -- who neighbours whom, across which face.
//! 2. [`tileset::Tileset`] -- the modules, and which sockets may meet.
//! 3. [`problem::Problem::compile`] -- expands sockets into per-link
//!    constraints, and rejects the cheap unsatisfiable cases up front.
//! 4. [`solver::solve_verified`] -- runs a backend, then checks its answer.

pub mod backend;
pub mod graph;
pub mod problem;
pub mod solver;
pub mod tileset;

pub use graph::{CellGraph, CellId, FaceId, GraphError, Link};
pub use problem::{LinkConstraint, Problem, ProblemError};
pub use solver::{
    Assignment, ConstraintSolver, SolveError, Violation, solve_verified,
};
pub use tileset::{Module, ModuleId, SocketId, Tileset, TilesetError};
