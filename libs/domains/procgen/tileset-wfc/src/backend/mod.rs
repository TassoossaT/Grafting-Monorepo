//! Solver backends.
//!
//! Each backend is one module behind one feature. The crate builds and its
//! model is testable with none of them enabled, which is the property that
//! makes a backend replaceable rather than load-bearing.

#[cfg(feature = "solver-wfc")]
pub mod wfc;

#[cfg(feature = "solver-wfc")]
pub use wfc::WaveFunctionCollapseSolver;
