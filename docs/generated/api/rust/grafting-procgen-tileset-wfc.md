# grafting-procgen-tileset-wfc

### `pub enum grafting_procgen_tileset_wfc::GraphError`

Why a graph could not be built.

### `pub enum grafting_procgen_tileset_wfc::ProblemError`

Why a problem is known to be unsolvable before a solver is asked.

This exists because the cost of asking is not bounded: proving a
constraint problem unsatisfiable can take arbitrarily long, and a backend
given a contradictory problem may search rather than fail. Catching the
cheap cases here turns a hang into an error naming the cell or link at
fault. It does not catch every unsatisfiable problem -- nothing cheap does.

### `pub enum grafting_procgen_tileset_wfc::SolveError`

Why a solve did not produce an assignment.

### `pub enum grafting_procgen_tileset_wfc::TilesetError`

Why a tileset could not be built.

### `pub enum grafting_procgen_tileset_wfc::Violation`

A way a result fails the problem it claims to solve.

### `pub enum grafting_procgen_tileset_wfc::graph::GraphError`

Why a graph could not be built.

### `pub enum grafting_procgen_tileset_wfc::problem::ProblemError`

Why a problem is known to be unsolvable before a solver is asked.

This exists because the cost of asking is not bounded: proving a
constraint problem unsatisfiable can take arbitrarily long, and a backend
given a contradictory problem may search rather than fail. Catching the
cheap cases here turns a hang into an error naming the cell or link at
fault. It does not catch every unsatisfiable problem -- nothing cheap does.

### `pub enum grafting_procgen_tileset_wfc::solver::SolveError`

Why a solve did not produce an assignment.

### `pub enum grafting_procgen_tileset_wfc::solver::Violation`

A way a result fails the problem it claims to solve.

### `pub enum grafting_procgen_tileset_wfc::tileset::TilesetError`

Why a tileset could not be built.

### `pub fn grafting_procgen_tileset_wfc::ConstraintSolver::solve(&self, problem: &grafting_procgen_tileset_wfc::problem::Problem, seed: u64) -> core::result::Result<grafting_procgen_tileset_wfc::solver::Assignment, grafting_procgen_tileset_wfc::solver::SolveError>`

Solves, or explains why it could not.

### `pub fn grafting_procgen_tileset_wfc::backend::wfc::WaveFunctionCollapseSolver::solve(&self, problem: &grafting_procgen_tileset_wfc::problem::Problem, seed: u64) -> core::result::Result<grafting_procgen_tileset_wfc::solver::Assignment, grafting_procgen_tileset_wfc::solver::SolveError>`

### `pub fn grafting_procgen_tileset_wfc::graph::CellGraph::cell_count(&self) -> usize`

How many cells the graph holds.

### `pub fn grafting_procgen_tileset_wfc::graph::CellGraph::faces_per_cell(&self) -> usize`

How many faces every cell has.

### `pub fn grafting_procgen_tileset_wfc::graph::CellGraph::links(&self) -> &[grafting_procgen_tileset_wfc::graph::Link]`

Every adjacency, in insertion order, so downstream output is stable.

### `pub fn grafting_procgen_tileset_wfc::graph::CellGraph::new(cell_count: usize, faces_per_cell: usize, links: impl core::iter::traits::collect::IntoIterator<Item = grafting_procgen_tileset_wfc::graph::Link>) -> core::result::Result<Self, grafting_procgen_tileset_wfc::graph::GraphError>`

Builds a graph, rejecting malformed adjacency rather than carrying it
into the solver, where it would surface as an unexplained contradiction.

### `pub fn grafting_procgen_tileset_wfc::problem::Problem::candidates(&self, cell: grafting_procgen_tileset_wfc::graph::CellId) -> &[grafting_procgen_tileset_wfc::tileset::ModuleId]`

The modules still permitted at `cell`.

### `pub fn grafting_procgen_tileset_wfc::problem::Problem::cell_count(&self) -> usize`

How many cells need a module.

### `pub fn grafting_procgen_tileset_wfc::problem::Problem::compile(graph: &grafting_procgen_tileset_wfc::graph::CellGraph, tileset: &grafting_procgen_tileset_wfc::tileset::Tileset, pinned: &[(grafting_procgen_tileset_wfc::graph::CellId, alloc::vec::Vec<grafting_procgen_tileset_wfc::tileset::ModuleId>)]) -> core::result::Result<Self, grafting_procgen_tileset_wfc::problem::ProblemError>`

Compiles a graph and a tileset into constraints.

`pinned` fixes cells ahead of the solve -- how an earlier pipeline
stage imposes what it already decided (which cells are underground,
which are open air). A cell absent from `pinned` may take any module.

### `pub fn grafting_procgen_tileset_wfc::problem::Problem::links(&self) -> &[grafting_procgen_tileset_wfc::problem::LinkConstraint]`

The per-link constraints, in graph order.

### `pub fn grafting_procgen_tileset_wfc::problem::Problem::module_count(&self) -> usize`

How many modules exist.

### `pub fn grafting_procgen_tileset_wfc::problem::Problem::names(&self) -> &[alloc::string::String]`

Caller-facing module names, by [`ModuleId`].

### `pub fn grafting_procgen_tileset_wfc::problem::Problem::weights(&self) -> &[f32]`

Relative likelihood of each module.

### `pub fn grafting_procgen_tileset_wfc::solve_verified<S: grafting_procgen_tileset_wfc::solver::ConstraintSolver>(solver: &S, problem: &grafting_procgen_tileset_wfc::problem::Problem, seed: u64) -> core::result::Result<grafting_procgen_tileset_wfc::solver::Assignment, grafting_procgen_tileset_wfc::solver::SolveError>`

Solves and then verifies, rejecting a result that does not satisfy the
problem rather than passing it on. Prefer this to calling a backend
directly.

### `pub fn grafting_procgen_tileset_wfc::solver::Assignment::module(&self, cell: grafting_procgen_tileset_wfc::graph::CellId) -> core::option::Option<grafting_procgen_tileset_wfc::tileset::ModuleId>`

The module chosen for `cell`.

### `pub fn grafting_procgen_tileset_wfc::solver::Assignment::modules(&self) -> &[grafting_procgen_tileset_wfc::tileset::ModuleId]`

Every choice, in cell order.

### `pub fn grafting_procgen_tileset_wfc::solver::Assignment::new(modules: alloc::vec::Vec<grafting_procgen_tileset_wfc::tileset::ModuleId>) -> Self`

Wraps a per-cell result.

### `pub fn grafting_procgen_tileset_wfc::solver::Assignment::violations(&self, problem: &grafting_procgen_tileset_wfc::problem::Problem) -> alloc::vec::Vec<grafting_procgen_tileset_wfc::solver::Violation>`

Checks the result actually satisfies the problem it came from.

Worth doing even against a trusted backend: it is the one check that
does not assume the backend is correct, which is precisely the
assumption a swappable backend should not require.

### `pub fn grafting_procgen_tileset_wfc::solver::ConstraintSolver::solve(&self, problem: &grafting_procgen_tileset_wfc::problem::Problem, seed: u64) -> core::result::Result<grafting_procgen_tileset_wfc::solver::Assignment, grafting_procgen_tileset_wfc::solver::SolveError>`

Solves, or explains why it could not.

### `pub fn grafting_procgen_tileset_wfc::solver::solve_verified<S: grafting_procgen_tileset_wfc::solver::ConstraintSolver>(solver: &S, problem: &grafting_procgen_tileset_wfc::problem::Problem, seed: u64) -> core::result::Result<grafting_procgen_tileset_wfc::solver::Assignment, grafting_procgen_tileset_wfc::solver::SolveError>`

Solves and then verifies, rejecting a result that does not satisfy the
problem rather than passing it on. Prefer this to calling a backend
directly.

### `pub fn grafting_procgen_tileset_wfc::tileset::Tileset::faces_per_cell(&self) -> usize`

How many faces each module declares.

### `pub fn grafting_procgen_tileset_wfc::tileset::Tileset::modules(&self) -> &[grafting_procgen_tileset_wfc::tileset::Module]`

The modules, in the order given.

### `pub fn grafting_procgen_tileset_wfc::tileset::Tileset::modules_meet(&self, left: grafting_procgen_tileset_wfc::tileset::ModuleId, left_face: usize, right: grafting_procgen_tileset_wfc::tileset::ModuleId, right_face: usize) -> bool`

Whether `left` on `left_face` may sit against `right` on `right_face`.

### `pub fn grafting_procgen_tileset_wfc::tileset::Tileset::new(modules: alloc::vec::Vec<grafting_procgen_tileset_wfc::tileset::Module>, compatible: impl core::iter::traits::collect::IntoIterator<Item = (grafting_procgen_tileset_wfc::tileset::SocketId, grafting_procgen_tileset_wfc::tileset::SocketId)>) -> core::result::Result<Self, grafting_procgen_tileset_wfc::tileset::TilesetError>`

Builds a tileset. Socket compatibility is symmetric: listing `(a, b)`
also permits `(b, a)`, since a shared face is one face.

### `pub fn grafting_procgen_tileset_wfc::tileset::Tileset::sockets_meet(&self, left: grafting_procgen_tileset_wfc::tileset::SocketId, right: grafting_procgen_tileset_wfc::tileset::SocketId) -> bool`

Whether two sockets may meet, in either order.

### `pub grafting_procgen_tileset_wfc::GraphError::DuplicateFace`

The same face of the same cell was linked twice.

### `pub grafting_procgen_tileset_wfc::GraphError::DuplicateFace::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::GraphError::DuplicateFace::face: grafting_procgen_tileset_wfc::graph::FaceId`

### `pub grafting_procgen_tileset_wfc::GraphError::SelfLink`

A cell was linked to itself.

### `pub grafting_procgen_tileset_wfc::GraphError::SelfLink::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::GraphError::UnknownCell`

A link referred to a cell outside the graph.

### `pub grafting_procgen_tileset_wfc::GraphError::UnknownCell::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::GraphError::UnknownCell::cell_count: usize`

### `pub grafting_procgen_tileset_wfc::GraphError::UnknownFace`

A link referred to a face the cells do not have.

### `pub grafting_procgen_tileset_wfc::GraphError::UnknownFace::face: grafting_procgen_tileset_wfc::graph::FaceId`

### `pub grafting_procgen_tileset_wfc::GraphError::UnknownFace::faces_per_cell: usize`

### `pub grafting_procgen_tileset_wfc::Link::from: grafting_procgen_tileset_wfc::graph::CellId`

The lower-indexed cell.

### `pub grafting_procgen_tileset_wfc::Link::from_face: grafting_procgen_tileset_wfc::graph::FaceId`

The face of `from` this link leaves by.

### `pub grafting_procgen_tileset_wfc::Link::to: grafting_procgen_tileset_wfc::graph::CellId`

The higher-indexed cell.

### `pub grafting_procgen_tileset_wfc::Link::to_face: grafting_procgen_tileset_wfc::graph::FaceId`

The face of `to` this link arrives at.

### `pub grafting_procgen_tileset_wfc::LinkConstraint::allowed: alloc::vec::Vec<(grafting_procgen_tileset_wfc::tileset::ModuleId, grafting_procgen_tileset_wfc::tileset::ModuleId)>`

`(module on `from`, module on `to`)` pairs that may coexist.

### `pub grafting_procgen_tileset_wfc::LinkConstraint::from: grafting_procgen_tileset_wfc::graph::CellId`

The lower-indexed cell.

### `pub grafting_procgen_tileset_wfc::LinkConstraint::to: grafting_procgen_tileset_wfc::graph::CellId`

The higher-indexed cell.

### `pub grafting_procgen_tileset_wfc::Module::name: alloc::string::String`

Caller-facing identity. Not interpreted here.

### `pub grafting_procgen_tileset_wfc::Module::sockets: alloc::vec::Vec<grafting_procgen_tileset_wfc::tileset::SocketId>`

The socket exposed on each face, indexed the same way the graph's
faces are.

### `pub grafting_procgen_tileset_wfc::Module::weight: f32`

Relative likelihood. Must be positive; higher is more frequent.

### `pub grafting_procgen_tileset_wfc::ProblemError::FaceCountMismatch`

The graph and the tileset disagree about how many faces a cell has.

### `pub grafting_procgen_tileset_wfc::ProblemError::FaceCountMismatch::graph: usize`

### `pub grafting_procgen_tileset_wfc::ProblemError::FaceCountMismatch::tileset: usize`

### `pub grafting_procgen_tileset_wfc::ProblemError::NoCandidates`

A cell has no module left to choose.

### `pub grafting_procgen_tileset_wfc::ProblemError::NoCandidates::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::ProblemError::NoCompatiblePair`

Two adjacent cells have no compatible pair of modules at all.

### `pub grafting_procgen_tileset_wfc::ProblemError::NoCompatiblePair::from: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::ProblemError::NoCompatiblePair::to: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::ProblemError::UnknownFixedModule`

A pre-placed module is not in the tileset.

### `pub grafting_procgen_tileset_wfc::ProblemError::UnknownFixedModule::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::ProblemError::UnknownFixedModule::module: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::SolveError::Contradiction`

The constraints admit no solution.

### `pub grafting_procgen_tileset_wfc::SolveError::Contradiction::detail: alloc::string::String`

### `pub grafting_procgen_tileset_wfc::SolveError::InvalidResult`

The backend produced something that does not satisfy the problem.

### `pub grafting_procgen_tileset_wfc::SolveError::InvalidResult::violations: alloc::vec::Vec<grafting_procgen_tileset_wfc::solver::Violation>`

### `pub grafting_procgen_tileset_wfc::SolveError::NoBackend`

No backend is compiled in.

### `pub grafting_procgen_tileset_wfc::TilesetError::Empty`

No modules were supplied.

### `pub grafting_procgen_tileset_wfc::TilesetError::FaceCountMismatch`

A module declared a different number of faces than the rest.

### `pub grafting_procgen_tileset_wfc::TilesetError::FaceCountMismatch::declared: usize`

### `pub grafting_procgen_tileset_wfc::TilesetError::FaceCountMismatch::expected: usize`

### `pub grafting_procgen_tileset_wfc::TilesetError::FaceCountMismatch::module: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::TilesetError::InvalidWeight`

A module's weight was zero, negative, or not a number.

### `pub grafting_procgen_tileset_wfc::TilesetError::InvalidWeight::module: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::Violation::IncompatibleNeighbours`

Two adjacent cells were given modules that cannot meet.

### `pub grafting_procgen_tileset_wfc::Violation::IncompatibleNeighbours::from: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::Violation::IncompatibleNeighbours::left: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::Violation::IncompatibleNeighbours::right: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::Violation::IncompatibleNeighbours::to: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::Violation::NotACandidate`

A cell was given a module its candidates did not permit.

### `pub grafting_procgen_tileset_wfc::Violation::NotACandidate::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::Violation::NotACandidate::module: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::Violation::WrongLength`

The backend returned a different number of cells than were asked for.

### `pub grafting_procgen_tileset_wfc::Violation::WrongLength::expected: usize`

### `pub grafting_procgen_tileset_wfc::Violation::WrongLength::produced: usize`

### `pub grafting_procgen_tileset_wfc::graph::GraphError::DuplicateFace`

The same face of the same cell was linked twice.

### `pub grafting_procgen_tileset_wfc::graph::GraphError::DuplicateFace::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::graph::GraphError::DuplicateFace::face: grafting_procgen_tileset_wfc::graph::FaceId`

### `pub grafting_procgen_tileset_wfc::graph::GraphError::SelfLink`

A cell was linked to itself.

### `pub grafting_procgen_tileset_wfc::graph::GraphError::SelfLink::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::graph::GraphError::UnknownCell`

A link referred to a cell outside the graph.

### `pub grafting_procgen_tileset_wfc::graph::GraphError::UnknownCell::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::graph::GraphError::UnknownCell::cell_count: usize`

### `pub grafting_procgen_tileset_wfc::graph::GraphError::UnknownFace`

A link referred to a face the cells do not have.

### `pub grafting_procgen_tileset_wfc::graph::GraphError::UnknownFace::face: grafting_procgen_tileset_wfc::graph::FaceId`

### `pub grafting_procgen_tileset_wfc::graph::GraphError::UnknownFace::faces_per_cell: usize`

### `pub grafting_procgen_tileset_wfc::graph::Link::from: grafting_procgen_tileset_wfc::graph::CellId`

The lower-indexed cell.

### `pub grafting_procgen_tileset_wfc::graph::Link::from_face: grafting_procgen_tileset_wfc::graph::FaceId`

The face of `from` this link leaves by.

### `pub grafting_procgen_tileset_wfc::graph::Link::to: grafting_procgen_tileset_wfc::graph::CellId`

The higher-indexed cell.

### `pub grafting_procgen_tileset_wfc::graph::Link::to_face: grafting_procgen_tileset_wfc::graph::FaceId`

The face of `to` this link arrives at.

### `pub grafting_procgen_tileset_wfc::problem::LinkConstraint::allowed: alloc::vec::Vec<(grafting_procgen_tileset_wfc::tileset::ModuleId, grafting_procgen_tileset_wfc::tileset::ModuleId)>`

`(module on `from`, module on `to`)` pairs that may coexist.

### `pub grafting_procgen_tileset_wfc::problem::LinkConstraint::from: grafting_procgen_tileset_wfc::graph::CellId`

The lower-indexed cell.

### `pub grafting_procgen_tileset_wfc::problem::LinkConstraint::to: grafting_procgen_tileset_wfc::graph::CellId`

The higher-indexed cell.

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::FaceCountMismatch`

The graph and the tileset disagree about how many faces a cell has.

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::FaceCountMismatch::graph: usize`

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::FaceCountMismatch::tileset: usize`

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::NoCandidates`

A cell has no module left to choose.

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::NoCandidates::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::NoCompatiblePair`

Two adjacent cells have no compatible pair of modules at all.

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::NoCompatiblePair::from: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::NoCompatiblePair::to: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::UnknownFixedModule`

A pre-placed module is not in the tileset.

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::UnknownFixedModule::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::problem::ProblemError::UnknownFixedModule::module: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::solver::SolveError::Contradiction`

The constraints admit no solution.

### `pub grafting_procgen_tileset_wfc::solver::SolveError::Contradiction::detail: alloc::string::String`

### `pub grafting_procgen_tileset_wfc::solver::SolveError::InvalidResult`

The backend produced something that does not satisfy the problem.

### `pub grafting_procgen_tileset_wfc::solver::SolveError::InvalidResult::violations: alloc::vec::Vec<grafting_procgen_tileset_wfc::solver::Violation>`

### `pub grafting_procgen_tileset_wfc::solver::SolveError::NoBackend`

No backend is compiled in.

### `pub grafting_procgen_tileset_wfc::solver::Violation::IncompatibleNeighbours`

Two adjacent cells were given modules that cannot meet.

### `pub grafting_procgen_tileset_wfc::solver::Violation::IncompatibleNeighbours::from: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::solver::Violation::IncompatibleNeighbours::left: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::solver::Violation::IncompatibleNeighbours::right: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::solver::Violation::IncompatibleNeighbours::to: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::solver::Violation::NotACandidate`

A cell was given a module its candidates did not permit.

### `pub grafting_procgen_tileset_wfc::solver::Violation::NotACandidate::cell: grafting_procgen_tileset_wfc::graph::CellId`

### `pub grafting_procgen_tileset_wfc::solver::Violation::NotACandidate::module: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::solver::Violation::WrongLength`

The backend returned a different number of cells than were asked for.

### `pub grafting_procgen_tileset_wfc::solver::Violation::WrongLength::expected: usize`

### `pub grafting_procgen_tileset_wfc::solver::Violation::WrongLength::produced: usize`

### `pub grafting_procgen_tileset_wfc::tileset::Module::name: alloc::string::String`

Caller-facing identity. Not interpreted here.

### `pub grafting_procgen_tileset_wfc::tileset::Module::sockets: alloc::vec::Vec<grafting_procgen_tileset_wfc::tileset::SocketId>`

The socket exposed on each face, indexed the same way the graph's
faces are.

### `pub grafting_procgen_tileset_wfc::tileset::Module::weight: f32`

Relative likelihood. Must be positive; higher is more frequent.

### `pub grafting_procgen_tileset_wfc::tileset::TilesetError::Empty`

No modules were supplied.

### `pub grafting_procgen_tileset_wfc::tileset::TilesetError::FaceCountMismatch`

A module declared a different number of faces than the rest.

### `pub grafting_procgen_tileset_wfc::tileset::TilesetError::FaceCountMismatch::declared: usize`

### `pub grafting_procgen_tileset_wfc::tileset::TilesetError::FaceCountMismatch::expected: usize`

### `pub grafting_procgen_tileset_wfc::tileset::TilesetError::FaceCountMismatch::module: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub grafting_procgen_tileset_wfc::tileset::TilesetError::InvalidWeight`

A module's weight was zero, negative, or not a number.

### `pub grafting_procgen_tileset_wfc::tileset::TilesetError::InvalidWeight::module: grafting_procgen_tileset_wfc::tileset::ModuleId`

### `pub mod grafting_procgen_tileset_wfc`

Tile assignment over an arbitrary cell graph.

Given cells, what is adjacent to what, and a set of modules declaring which
sockets they expose, this picks one module per cell such that neighbouring
modules fit. It is the generic capability behind a Townscaper-style terrain
pass, but knows nothing about terrain, elevation, or meshes -- a caller
that wants dungeon rooms or interior furniture uses the same crate with a
different tileset.

# Why the solver is behind a trait

The constraint engine is expected to change. Callers therefore depend on
[`solver::ConstraintSolver`] and on this crate's own types; no third-party
type appears in any public signature here. A backend lives in one module
behind one cargo feature ([`backend`]), so switching engines -- to another
crate, to our own implementation, to a maintained fork -- touches that
module and the feature, and nothing else in the repository.

# Shape of a run

1. [`graph::CellGraph`] -- who neighbours whom, across which face.
2. [`tileset::Tileset`] -- the modules, and which sockets may meet.
3. [`problem::Problem::compile`] -- expands sockets into per-link
   constraints, and rejects the cheap unsatisfiable cases up front.
4. [`solver::solve_verified`] -- runs a backend, then checks its answer.

### `pub mod grafting_procgen_tileset_wfc::backend`

Solver backends.

Each backend is one module behind one feature. The crate builds and its
model is testable with none of them enabled, which is the property that
makes a backend replaceable rather than load-bearing.

### `pub mod grafting_procgen_tileset_wfc::backend::wfc`

The `wave-function-collapse` backend.

This module is the only place in the repository that names that crate. It
translates our [`Problem`] into that crate's vocabulary and translates the
result back; nothing leaks in either direction. Replacing it means writing
a sibling module and flipping a feature -- no caller changes.

Why this crate was chosen over `ghx_proc_gen`, which the research
originally selected: its constraints are declared per neighbour pair rather
than per global direction. `ghx_proc_gen`'s solver requires that the
neighbour of `n` in direction `d` has `n` as its neighbour in the opposite
direction, with direction indices fixed globally -- a labelling our
irregular grid provably does not admit. Nothing here needs directions at
all.

### `pub mod grafting_procgen_tileset_wfc::graph`

The cell graph: what is adjacent to what, and across which face.

Deliberately not a grid. Cells are opaque indices and adjacency is an
explicit list of links, because the grids this must serve are irregular --
a quad grid relaxed off the lattice has interior vertices of valence other
than four, which no fixed set of compass directions can label consistently.
Encoding adjacency per link rather than per direction sidesteps that
entirely.

### `pub mod grafting_procgen_tileset_wfc::problem`

The compiled, solver-agnostic constraint problem.

This is the seam. A backend receives a [`Problem`] and returns an
[`crate::solver::Assignment`]; it never sees a tileset, a socket, or a
grid. Everything specific to a third-party engine lives on the far side of
it, so replacing that engine -- with another crate, with our own, with a
fork -- is a change to one adapter rather than to every caller.

The form chosen is the one every constraint engine can consume: per cell,
the modules still permitted; per link, the module pairs permitted across
it. Sockets are expanded away here, once, rather than each backend having
to understand them.

### `pub mod grafting_procgen_tileset_wfc::solver`

The capability, stated as a trait, and the result it produces.

Nothing here mentions a particular engine. A backend is anything that can
turn a [`Problem`] into an [`Assignment`] reproducibly from a seed.

### `pub mod grafting_procgen_tileset_wfc::tileset`

Modules and the sockets that decide what may sit next to what.

The socket idea is what keeps the tileset from becoming a rule per pair of
meshes: a module declares which connector it exposes on each face, once,
and compatibility is a relation between connectors. Adding a mesh means
declaring its sockets, not relating it to every existing mesh.

### `pub struct grafting_procgen_tileset_wfc::Assignment`

One module chosen per cell, indexed by [`CellId`].

### `pub struct grafting_procgen_tileset_wfc::CellGraph`

Cells and the links between them.

### `pub struct grafting_procgen_tileset_wfc::Link`

One undirected adjacency, recorded once.

### `pub struct grafting_procgen_tileset_wfc::LinkConstraint`

Allowed module pairs across one adjacency.

### `pub struct grafting_procgen_tileset_wfc::Module`

One placeable thing: a mesh, a tile, a marker. This crate never looks
inside it; `name` exists so callers can map a result back to their asset.

### `pub struct grafting_procgen_tileset_wfc::Problem`

A fully compiled problem: candidates per cell, constraints per link.

### `pub struct grafting_procgen_tileset_wfc::Tileset`

The modules available, plus which sockets may meet.

### `pub struct grafting_procgen_tileset_wfc::backend::WaveFunctionCollapseSolver`

A [`ConstraintSolver`] backed by the `wave-function-collapse` crate.

### `pub struct grafting_procgen_tileset_wfc::backend::wfc::WaveFunctionCollapseSolver`

A [`ConstraintSolver`] backed by the `wave-function-collapse` crate.

### `pub struct grafting_procgen_tileset_wfc::graph::CellGraph`

Cells and the links between them.

### `pub struct grafting_procgen_tileset_wfc::graph::Link`

One undirected adjacency, recorded once.

### `pub struct grafting_procgen_tileset_wfc::problem::LinkConstraint`

Allowed module pairs across one adjacency.

### `pub struct grafting_procgen_tileset_wfc::problem::Problem`

A fully compiled problem: candidates per cell, constraints per link.

### `pub struct grafting_procgen_tileset_wfc::solver::Assignment`

One module chosen per cell, indexed by [`CellId`].

### `pub struct grafting_procgen_tileset_wfc::tileset::Module`

One placeable thing: a mesh, a tile, a marker. This crate never looks
inside it; `name` exists so callers can map a result back to their asset.

### `pub struct grafting_procgen_tileset_wfc::tileset::Tileset`

The modules available, plus which sockets may meet.

### `pub trait grafting_procgen_tileset_wfc::ConstraintSolver`

Turns a problem into an assignment.

Implement this to add a backend. The only contract is reproducibility:
the same problem and the same seed must give the same assignment, because
the map is replicated state and two hosts generating "the same" map must
agree. Different seeds should generally differ, or the tileset buys
nothing over deriving the geometry directly.

### `pub trait grafting_procgen_tileset_wfc::solver::ConstraintSolver`

Turns a problem into an assignment.

Implement this to add a backend. The only contract is reproducibility:
the same problem and the same seed must give the same assignment, because
the map is replicated state and two hosts generating "the same" map must
agree. Different seeds should generally differ, or the tileset buys
nothing over deriving the geometry directly.

### `pub type grafting_procgen_tileset_wfc::CellId = usize`

Index of a cell. Meaningful only to the caller that built the graph.

### `pub type grafting_procgen_tileset_wfc::FaceId = usize`

Which face of a cell a link leaves by.

A face index is local to its cell: face 2 of one cell has no relation to
face 2 of another. This is what lets an irregular grid be described at all.

### `pub type grafting_procgen_tileset_wfc::ModuleId = usize`

Index of a module within a [`Tileset`].

### `pub type grafting_procgen_tileset_wfc::SocketId = usize`

Index of a socket -- a connector shape two faces must share to meet.

### `pub type grafting_procgen_tileset_wfc::graph::CellId = usize`

Index of a cell. Meaningful only to the caller that built the graph.

### `pub type grafting_procgen_tileset_wfc::graph::FaceId = usize`

Which face of a cell a link leaves by.

A face index is local to its cell: face 2 of one cell has no relation to
face 2 of another. This is what lets an irregular grid be described at all.

### `pub type grafting_procgen_tileset_wfc::tileset::ModuleId = usize`

Index of a module within a [`Tileset`].

### `pub type grafting_procgen_tileset_wfc::tileset::SocketId = usize`

Index of a socket -- a connector shape two faces must share to meet.
