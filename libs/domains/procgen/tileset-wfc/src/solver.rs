//! The capability, stated as a trait, and the result it produces.
//!
//! Nothing here mentions a particular engine. A backend is anything that can
//! turn a [`Problem`] into an [`Assignment`] reproducibly from a seed.

use crate::graph::CellId;
use crate::problem::Problem;
use crate::tileset::ModuleId;

/// One module chosen per cell, indexed by [`CellId`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assignment {
    modules: Vec<ModuleId>,
}

impl Assignment {
    /// Wraps a per-cell result.
    pub fn new(modules: Vec<ModuleId>) -> Self {
        Self { modules }
    }

    /// The module chosen for `cell`.
    pub fn module(&self, cell: CellId) -> Option<ModuleId> {
        self.modules.get(cell).copied()
    }

    /// Every choice, in cell order.
    pub fn modules(&self) -> &[ModuleId] {
        &self.modules
    }

    /// Checks the result actually satisfies the problem it came from.
    ///
    /// Worth doing even against a trusted backend: it is the one check that
    /// does not assume the backend is correct, which is precisely the
    /// assumption a swappable backend should not require.
    pub fn violations(&self, problem: &Problem) -> Vec<Violation> {
        let mut found = Vec::new();
        if self.modules.len() != problem.cell_count() {
            found.push(Violation::WrongLength {
                produced: self.modules.len(),
                expected: problem.cell_count(),
            });
            return found;
        }
        for (cell, &module) in self.modules.iter().enumerate() {
            if !problem.candidates(cell).contains(&module) {
                found.push(Violation::NotACandidate { cell, module });
            }
        }
        for link in problem.links() {
            let (Some(&left), Some(&right)) =
                (self.modules.get(link.from), self.modules.get(link.to))
            else {
                continue;
            };
            if !link.allowed.contains(&(left, right)) {
                found.push(Violation::IncompatibleNeighbours {
                    from: link.from,
                    to: link.to,
                    left,
                    right,
                });
            }
        }
        found
    }
}

/// A way a result fails the problem it claims to solve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Violation {
    /// The backend returned a different number of cells than were asked for.
    WrongLength { produced: usize, expected: usize },
    /// A cell was given a module its candidates did not permit.
    NotACandidate { cell: CellId, module: ModuleId },
    /// Two adjacent cells were given modules that cannot meet.
    IncompatibleNeighbours { from: CellId, to: CellId, left: ModuleId, right: ModuleId },
}

/// Why a solve did not produce an assignment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SolveError {
    /// The constraints admit no solution.
    Contradiction { detail: String },
    /// The backend produced something that does not satisfy the problem.
    InvalidResult { violations: Vec<Violation> },
    /// No backend is compiled in.
    NoBackend,
}

impl core::fmt::Display for SolveError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Contradiction { detail } => write!(f, "no solution exists: {detail}"),
            Self::InvalidResult { violations } => {
                write!(f, "the backend returned an invalid assignment: {violations:?}")
            }
            Self::NoBackend => write!(
                f,
                "no solver backend is enabled; build with a `solver-*` feature",
            ),
        }
    }
}

/// Turns a problem into an assignment.
///
/// Implement this to add a backend. The only contract is reproducibility:
/// the same problem and the same seed must give the same assignment, because
/// the map is replicated state and two hosts generating "the same" map must
/// agree. Different seeds should generally differ, or the tileset buys
/// nothing over deriving the geometry directly.
pub trait ConstraintSolver {
    /// Solves, or explains why it could not.
    fn solve(&self, problem: &Problem, seed: u64) -> Result<Assignment, SolveError>;
}

/// Solves and then verifies, rejecting a result that does not satisfy the
/// problem rather than passing it on. Prefer this to calling a backend
/// directly.
pub fn solve_verified<S: ConstraintSolver>(
    solver: &S,
    problem: &Problem,
    seed: u64,
) -> Result<Assignment, SolveError> {
    let assignment = solver.solve(problem, seed)?;
    let violations = assignment.violations(problem);
    if violations.is_empty() {
        Ok(assignment)
    } else {
        Err(SolveError::InvalidResult { violations })
    }
}
