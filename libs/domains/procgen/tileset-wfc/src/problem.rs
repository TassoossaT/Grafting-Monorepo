//! The compiled, solver-agnostic constraint problem.
//!
//! This is the seam. A backend receives a [`Problem`] and returns an
//! [`crate::solver::Assignment`]; it never sees a tileset, a socket, or a
//! grid. Everything specific to a third-party engine lives on the far side of
//! it, so replacing that engine -- with another crate, with our own, with a
//! fork -- is a change to one adapter rather than to every caller.
//!
//! The form chosen is the one every constraint engine can consume: per cell,
//! the modules still permitted; per link, the module pairs permitted across
//! it. Sockets are expanded away here, once, rather than each backend having
//! to understand them.

use crate::graph::{CellGraph, CellId};
use crate::rotation::ModuleOrigin;
use crate::tileset::{ModuleId, Tileset};

/// Allowed module pairs across one adjacency.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkConstraint {
    /// The lower-indexed cell.
    pub from: CellId,
    /// The higher-indexed cell.
    pub to: CellId,
    /// `(module on `from`, module on `to`)` pairs that may coexist.
    pub allowed: Vec<(ModuleId, ModuleId)>,
}

/// A fully compiled problem: candidates per cell, constraints per link.
#[derive(Debug, Clone)]
pub struct Problem {
    candidates: Vec<Vec<ModuleId>>,
    weights: Vec<f32>,
    names: Vec<String>,
    origins: Vec<ModuleOrigin>,
    links: Vec<LinkConstraint>,
}

/// Why a problem is known to be unsolvable before a solver is asked.
///
/// This exists because the cost of asking is not bounded: proving a
/// constraint problem unsatisfiable can take arbitrarily long, and a backend
/// given a contradictory problem may search rather than fail. Catching the
/// cheap cases here turns a hang into an error naming the cell or link at
/// fault. It does not catch every unsatisfiable problem -- nothing cheap does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProblemError {
    /// The graph and the tileset disagree about how many faces a cell has.
    FaceCountMismatch { graph: usize, tileset: usize },
    /// A cell has no module left to choose.
    NoCandidates { cell: CellId },
    /// A pre-placed module is not in the tileset.
    UnknownFixedModule { cell: CellId, module: ModuleId },
    /// Two adjacent cells have no compatible pair of modules at all.
    NoCompatiblePair { from: CellId, to: CellId },
}

impl core::fmt::Display for ProblemError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::FaceCountMismatch { graph, tileset } => write!(
                f,
                "the graph's cells have {graph} faces but the tileset's modules declare {tileset}",
            ),
            Self::NoCandidates { cell } => {
                write!(f, "cell {cell} has no candidate module")
            }
            Self::UnknownFixedModule { cell, module } => {
                write!(f, "cell {cell} is pinned to module {module}, which the tileset lacks")
            }
            Self::NoCompatiblePair { from, to } => write!(
                f,
                "cells {from} and {to} are adjacent but share no compatible module pair, so no \
                 solution exists; check their sockets or the constraints pinning them",
            ),
        }
    }
}

impl Problem {
    /// Compiles a graph and a tileset into constraints.
    ///
    /// `pinned` fixes cells ahead of the solve -- how an earlier pipeline
    /// stage imposes what it already decided (which cells are underground,
    /// which are open air). A cell absent from `pinned` may take any module.
    pub fn compile(
        graph: &CellGraph,
        tileset: &Tileset,
        pinned: &[(CellId, Vec<ModuleId>)],
    ) -> Result<Self, ProblemError> {
        if graph.faces_per_cell() != tileset.faces_per_cell() {
            return Err(ProblemError::FaceCountMismatch {
                graph: graph.faces_per_cell(),
                tileset: tileset.faces_per_cell(),
            });
        }

        let module_count = tileset.modules().len();
        let mut candidates: Vec<Vec<ModuleId>> =
            vec![(0..module_count).collect(); graph.cell_count()];

        for (cell, allowed) in pinned {
            let Some(slot) = candidates.get_mut(*cell) else {
                return Err(ProblemError::NoCandidates { cell: *cell });
            };
            for module in allowed {
                if *module >= module_count {
                    return Err(ProblemError::UnknownFixedModule { cell: *cell, module: *module });
                }
            }
            let mut narrowed = allowed.clone();
            narrowed.sort_unstable();
            narrowed.dedup();
            *slot = narrowed;
        }

        for (cell, allowed) in candidates.iter().enumerate() {
            if allowed.is_empty() {
                return Err(ProblemError::NoCandidates { cell });
            }
        }

        let mut links = Vec::with_capacity(graph.links().len());
        for link in graph.links() {
            let mut allowed = Vec::new();
            for &left in &candidates[link.from] {
                for &right in &candidates[link.to] {
                    if tileset.modules_meet(left, link.from_face, right, link.to_face) {
                        allowed.push((left, right));
                    }
                }
            }
            if allowed.is_empty() {
                return Err(ProblemError::NoCompatiblePair { from: link.from, to: link.to });
            }
            links.push(LinkConstraint { from: link.from, to: link.to, allowed });
        }

        Ok(Self {
            candidates,
            weights: tileset.modules().iter().map(|module| module.weight).collect(),
            names: tileset.modules().iter().map(|module| module.name.clone()).collect(),
            origins: (0..module_count)
                .map(|module| {
                    tileset.origin(module).unwrap_or(ModuleOrigin { source: module, turns: 0 })
                })
                .collect(),
            links,
        })
    }

    /// How many cells need a module.
    pub fn cell_count(&self) -> usize {
        self.candidates.len()
    }

    /// How many modules exist.
    pub fn module_count(&self) -> usize {
        self.weights.len()
    }

    /// The modules still permitted at `cell`.
    pub fn candidates(&self, cell: CellId) -> &[ModuleId] {
        self.candidates.get(cell).map_or(&[], Vec::as_slice)
    }

    /// Relative likelihood of each module.
    pub fn weights(&self) -> &[f32] {
        &self.weights
    }

    /// Caller-facing module names, by [`ModuleId`].
    pub fn names(&self) -> &[String] {
        &self.names
    }

    /// Which authored module each [`ModuleId`] came from, and how far it
    /// turned. Carried through the compile so a caller on the far side of a
    /// language boundary can map a result back to its asset without holding
    /// the tileset.
    pub fn origins(&self) -> &[ModuleOrigin] {
        &self.origins
    }

    /// The per-link constraints, in graph order.
    pub fn links(&self) -> &[LinkConstraint] {
        &self.links
    }
}
