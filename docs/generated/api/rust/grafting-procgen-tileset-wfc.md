# grafting-procgen-tileset-wfc

### `pub const grafting_procgen_tileset_wfc::wasm::COMPATIBLE_STRIDE: usize`

Numbers per entry in the flat `compatible` array: the two socket ids.

### `pub const grafting_procgen_tileset_wfc::wasm::LINK_STRIDE: usize`

Numbers per link in the flat `links` array: from, from_face, to, to_face.

### `pub const grafting_procgen_tileset_wfc::wasm::PINNED_STRIDE: usize`

Numbers per entry in the flat `pinned` array: the cell, then one module it
is still permitted to take.

### `pub enum grafting_procgen_tileset_wfc::GraphError`

Why a graph could not be built.

### `pub enum grafting_procgen_tileset_wfc::ProblemError`

Why a problem is known to be unsolvable before a solver is asked.

This exists because the cost of asking is not bounded: proving a
constraint problem unsatisfiable can take arbitrarily long, and a backend
given a contradictory problem may search rather than fail. Catching the
cheap cases here turns a hang into an error naming the cell or link at
fault. It does not catch every unsatisfiable problem -- nothing cheap does.

### `pub enum grafting_procgen_tileset_wfc::RotationError`

Why a rotation could not be built.

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

### `pub enum grafting_procgen_tileset_wfc::rotation::RotationError`

Why a rotation could not be built.

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

### `pub fn grafting_procgen_tileset_wfc::problem::Problem::origins(&self) -> &[grafting_procgen_tileset_wfc::rotation::ModuleOrigin]`

Which authored module each [`ModuleId`] came from, and how far it
turned. Carried through the compile so a caller on the far side of a
language boundary can map a result back to its asset without holding
the tileset.

### `pub fn grafting_procgen_tileset_wfc::problem::Problem::weights(&self) -> &[f32]`

Relative likelihood of each module.

### `pub fn grafting_procgen_tileset_wfc::rotation::Rotation::apply(&self, sockets: &[grafting_procgen_tileset_wfc::tileset::SocketId], turns: usize) -> core::option::Option<alloc::vec::Vec<grafting_procgen_tileset_wfc::tileset::SocketId>>`

Applies `turns` turns to a socket list.

Returns `None` if a face in the cycle is outside `sockets`, rather than
silently producing a module with the wrong sockets.

### `pub fn grafting_procgen_tileset_wfc::rotation::Rotation::cycle(faces: impl core::iter::traits::collect::IntoIterator<Item = grafting_procgen_tileset_wfc::graph::FaceId>) -> core::result::Result<Self, grafting_procgen_tileset_wfc::rotation::RotationError>`

A rotation that carries the socket on each listed face to the next
listed face, wrapping at the end. Faces not listed are left alone.

### `pub fn grafting_procgen_tileset_wfc::rotation::Rotation::faces(&self) -> &[grafting_procgen_tileset_wfc::graph::FaceId]`

The faces taking part, in cycle order.

### `pub fn grafting_procgen_tileset_wfc::rotation::Rotation::none() -> Self`

The identity: every module keeps exactly the orientation it was given.

### `pub fn grafting_procgen_tileset_wfc::rotation::Rotation::order(&self) -> usize`

How many turns bring a module back to itself. `1` for the identity.

### `pub fn grafting_procgen_tileset_wfc::rotation::expand(modules: &[grafting_procgen_tileset_wfc::tileset::Module], rotation: &grafting_procgen_tileset_wfc::rotation::Rotation) -> (alloc::vec::Vec<grafting_procgen_tileset_wfc::tileset::Module>, alloc::vec::Vec<grafting_procgen_tileset_wfc::rotation::ModuleOrigin>)`

Expands each module into its distinct orientations.

The returned modules are in a stable order -- source module by source
module, turns ascending -- so a given input always yields the same
[`ModuleId`]s, which is what lets a seed reproduce a map.

Names are suffixed with `@<turns>` only for variants past the first, so an
unrotated or symmetric module keeps the name the caller gave it.

### `pub fn grafting_procgen_tileset_wfc::rotation::origin_of(origins: &[grafting_procgen_tileset_wfc::rotation::ModuleOrigin], module: grafting_procgen_tileset_wfc::tileset::ModuleId) -> core::option::Option<grafting_procgen_tileset_wfc::rotation::ModuleOrigin>`

Where a generated module came from, or `None` for a tileset built without
rotation.

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

### `pub fn grafting_procgen_tileset_wfc::tileset::Tileset::origin(&self, module: grafting_procgen_tileset_wfc::tileset::ModuleId) -> core::option::Option<grafting_procgen_tileset_wfc::rotation::ModuleOrigin>`

Which authored module a [`ModuleId`] came from, and how far it turned.

A caller that generated orientations needs this to map a result back to
its asset: the mesh comes from `source`, spun by `turns`.

### `pub fn grafting_procgen_tileset_wfc::tileset::Tileset::rotated(modules: alloc::vec::Vec<grafting_procgen_tileset_wfc::tileset::Module>, compatible: impl core::iter::traits::collect::IntoIterator<Item = (grafting_procgen_tileset_wfc::tileset::SocketId, grafting_procgen_tileset_wfc::tileset::SocketId)>, rotation: &grafting_procgen_tileset_wfc::rotation::Rotation) -> core::result::Result<Self, grafting_procgen_tileset_wfc::tileset::TilesetError>`

Builds a tileset from modules authored in one orientation, generating
the others.

See [`crate::rotation`] for what a rotation means here and why symmetric
modules do not produce duplicates. Validation happens after expansion,
so a face count is checked against the modules that will actually be
solved with.

### `pub fn grafting_procgen_tileset_wfc::tileset::Tileset::sockets_meet(&self, left: grafting_procgen_tileset_wfc::tileset::SocketId, right: grafting_procgen_tileset_wfc::tileset::SocketId) -> bool`

Whether two sockets may meet, in either order.

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::describe()`

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::describe_vector()`

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::into_abi(self) -> Self::Abi`

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::is_none(abi: &Self::Abi) -> bool`

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::modules(&self) -> alloc::vec::Vec<u32>`

The chosen variant per cell, indexing the expanded tileset.

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::none() -> Self::Abi`

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::sources(&self) -> alloc::vec::Vec<u32>`

The authored module per cell, indexing the array the caller supplied.

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::try_from_js_value(value: wasm_bindgen::JsValue) -> core::result::Result<Self, wasm_bindgen::JsValue>`

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::try_from_js_value_ref(value: &wasm_bindgen::JsValue) -> core::option::Option<Self>`

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::turns(&self) -> alloc::vec::Vec<u32>`

How many turns to apply to that module's mesh, per cell.

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::variant_count(&self) -> u32`

How many variants the authored modules expanded into. Useful for
telling "my tileset is too small" apart from "my constraints are wrong".

### `pub fn grafting_procgen_tileset_wfc::wasm::WfcSolution::vector_into_abi(vector: alloc::boxed::Box<[grafting_procgen_tileset_wfc::wasm::WfcSolution]>) -> Self::Abi`

### `pub fn grafting_procgen_tileset_wfc::wasm::solve_inner(cell_count: u32, faces_per_cell: u32, links: &[u32], module_sockets: &[u32], module_weights: &[f32], compatible: &[u32], rotation_cycle: &[u32], pinned: &[u32], seed: u32) -> core::result::Result<grafting_procgen_tileset_wfc::wasm::WfcSolution, alloc::string::String>`

The boundary's body, as a plain `Result<_, String>`.

Split out so it is reachable from a native test. A bridge that can only be
exercised in a browser is a bridge nobody tests.

### `pub fn grafting_procgen_tileset_wfc::wasm::solve_tileset(cell_count: u32, faces_per_cell: u32, links: &[u32], module_sockets: &[u32], module_weights: &[f32], compatible: &[u32], rotation_cycle: &[u32], pinned: &[u32], seed: u32) -> core::result::Result<grafting_procgen_tileset_wfc::wasm::WfcSolution, wasm_bindgen::JsValue>`

Solves a tile assignment over an arbitrary cell graph.

* `cell_count`, `faces_per_cell` -- the graph's shape. A face index is
  local to its cell; see [`crate::graph`] for why that is the whole point.
* `links` -- adjacency, `LINK_STRIDE` numbers each, each undirected
  adjacency listed once.
* `module_sockets` -- `faces_per_cell` socket ids per authored module,
  concatenated; its length divided by `faces_per_cell` is the module count.
* `module_weights` -- one positive weight per authored module. A module's
  weight is shared across the orientations it expands into, so making a
  piece asymmetric does not make it more common.
* `compatible` -- socket pairs that may meet, `COMPATIBLE_STRIDE` each.
  Symmetric: listing `(a, b)` also permits `(b, a)`.
* `rotation_cycle` -- face indices that rotate among themselves, in order.
  Empty means modules are used exactly as authored. For a stacked quad grid
  this is the four lateral faces, leaving up and down alone.
* `pinned` -- `(cell, module)` pairs restricting a cell to the authored
  modules listed for it. A cell absent here may take anything. This is how
  an earlier pipeline stage imposes what it already decided.
* `seed` -- the same seed and the same inputs give the same map.

# Errors

Throws with a message naming the offending cell, link or module. Known-
impossible problems are rejected during compilation rather than handed to
the solver, which would otherwise search for an unbounded time.

### `pub fn wasm_bindgen::JsValue::from(value: grafting_procgen_tileset_wfc::wasm::WfcSolution) -> Self`

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

### `pub grafting_procgen_tileset_wfc::ModuleOrigin::source: usize`

Index of the module as the caller supplied it.

### `pub grafting_procgen_tileset_wfc::ModuleOrigin::turns: usize`

How many turns were applied. `0` is the module as authored.

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

### `pub grafting_procgen_tileset_wfc::RotationError::RepeatedFace`

The same face appeared twice in the cycle, which is not a permutation.

### `pub grafting_procgen_tileset_wfc::RotationError::RepeatedFace::face: grafting_procgen_tileset_wfc::graph::FaceId`

### `pub grafting_procgen_tileset_wfc::SolveError::InvalidResult`

The backend produced something that does not satisfy the problem.

### `pub grafting_procgen_tileset_wfc::SolveError::InvalidResult::violations: alloc::vec::Vec<grafting_procgen_tileset_wfc::solver::Violation>`

### `pub grafting_procgen_tileset_wfc::SolveError::NoBackend`

No backend is compiled in.

### `pub grafting_procgen_tileset_wfc::SolveError::SearchFailed`

The backend gave up without an assignment.

This is **not** a proof that none exists. The backend is a greedy
wave-function collapse: it settles cells one at a time and cannot undo
a choice, so it reaches dead ends on problems that are perfectly
satisfiable. Distinguishing the two would mean a complete search, which
this crate does not do -- so it says what actually happened and leaves
the conclusion to the caller. Retrying with another seed is the
conventional response and is often enough.

### `pub grafting_procgen_tileset_wfc::SolveError::SearchFailed::detail: alloc::string::String`

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

### `pub grafting_procgen_tileset_wfc::rotation::ModuleOrigin::source: usize`

Index of the module as the caller supplied it.

### `pub grafting_procgen_tileset_wfc::rotation::ModuleOrigin::turns: usize`

How many turns were applied. `0` is the module as authored.

### `pub grafting_procgen_tileset_wfc::rotation::RotationError::RepeatedFace`

The same face appeared twice in the cycle, which is not a permutation.

### `pub grafting_procgen_tileset_wfc::rotation::RotationError::RepeatedFace::face: grafting_procgen_tileset_wfc::graph::FaceId`

### `pub grafting_procgen_tileset_wfc::solver::SolveError::InvalidResult`

The backend produced something that does not satisfy the problem.

### `pub grafting_procgen_tileset_wfc::solver::SolveError::InvalidResult::violations: alloc::vec::Vec<grafting_procgen_tileset_wfc::solver::Violation>`

### `pub grafting_procgen_tileset_wfc::solver::SolveError::NoBackend`

No backend is compiled in.

### `pub grafting_procgen_tileset_wfc::solver::SolveError::SearchFailed`

The backend gave up without an assignment.

This is **not** a proof that none exists. The backend is a greedy
wave-function collapse: it settles cells one at a time and cannot undo
a choice, so it reaches dead ends on problems that are perfectly
satisfiable. Distinguishing the two would mean a complete search, which
this crate does not do -- so it says what actually happened and leaves
the conclusion to the caller. Retrying with another seed is the
conventional response and is often enough.

### `pub grafting_procgen_tileset_wfc::solver::SolveError::SearchFailed::detail: alloc::string::String`

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

### `pub mod grafting_procgen_tileset_wfc::rotation`

Turning one authored module into the set of its distinct orientations.

Without this a tileset has to spell out every orientation by hand: an
asymmetric piece becomes four near-identical entries whose sockets must stay
in step, and the authoring cost is what makes people reach for a smaller,
worse tileset. Generating the orientations removes that cost and removes the
class of bug where one hand-written variant has a socket wrong.

# What a rotation is here

Not a transform of geometry -- this crate never sees geometry. A rotation is
a permutation of *face indices*, given as a cycle. Rotating a module by one
turn moves the socket on `cycle[i]` to `cycle[i + 1]`; faces outside the
cycle keep their socket. That is what makes it usable on an irregular grid,
where a cell's lateral faces are local slots that rotate among themselves
while its up and down faces do not rotate at all.

# Symmetry is detected, not declared

A module whose sockets are unchanged by a turn produces the same variant
twice, and the duplicate is dropped. So flat ground yields one variant and a
corner piece yields four, without either being annotated. The caller's
`weight` is the weight of the *module*, and is divided across the variants
it produced, so making a piece asymmetric does not silently make it four
times as common.

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

### `pub mod grafting_procgen_tileset_wfc::wasm`

The Web boundary: a flat, typed-array ABI over the solver-agnostic model.

Everything crossing this boundary is a number. There is no socket type, no
module struct and -- most importantly -- no third-party solver type, which
is what lets the engine be replaced without any JavaScript changing. The
caller describes a graph and a tileset as integers and gets integers back.

# Why the shape is what it is

Variable-length structures are expressed as a flat array plus a stride,
rather than as objects, because crossing the boundary once with a
`Uint32Array` costs a memory copy while crossing it per module costs a call
per module. The grids this serves have thousands of cells.

Panics are not catchable on `wasm32-unknown-unknown`, so every argument is
validated here and reported as a thrown `Error` -- the same discipline the
sibling procgen bridges document. An invalid input must reject, not abort
the caller's worker.

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

### `pub struct grafting_procgen_tileset_wfc::ModuleOrigin`

Which authored module a generated variant came from, and how far it turned.

### `pub struct grafting_procgen_tileset_wfc::Problem`

A fully compiled problem: candidates per cell, constraints per link.

### `pub struct grafting_procgen_tileset_wfc::Rotation`

A cyclic permutation of face indices.

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

### `pub struct grafting_procgen_tileset_wfc::rotation::ModuleOrigin`

Which authored module a generated variant came from, and how far it turned.

### `pub struct grafting_procgen_tileset_wfc::rotation::Rotation`

A cyclic permutation of face indices.

### `pub struct grafting_procgen_tileset_wfc::solver::Assignment`

One module chosen per cell, indexed by [`CellId`].

### `pub struct grafting_procgen_tileset_wfc::tileset::Module`

One placeable thing: a mesh, a tile, a marker. This crate never looks
inside it; `name` exists so callers can map a result back to their asset.

### `pub struct grafting_procgen_tileset_wfc::tileset::Tileset`

The modules available, plus which sockets may meet.

### `pub struct grafting_procgen_tileset_wfc::wasm::WfcSolution`

One solved map, as parallel arrays indexed by cell.

`source` and `turns` are the answer a renderer actually needs: which
authored module's mesh to draw, and how far to spin it. They are returned
rather than the caller re-deriving them, because the expansion that
produced the variants happened on this side of the boundary.

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

### `pub type grafting_procgen_tileset_wfc::wasm::WfcSolution::Abi = <alloc::boxed::Box<[wasm_bindgen::JsValue]> as wasm_bindgen::convert::traits::FromWasmAbi>::Abi`

### `pub type grafting_procgen_tileset_wfc::wasm::WfcSolution::Abi = <alloc::boxed::Box<[wasm_bindgen::JsValue]> as wasm_bindgen::convert::traits::IntoWasmAbi>::Abi`

### `pub type grafting_procgen_tileset_wfc::wasm::WfcSolution::Abi = wasm_bindgen::__rt::WasmPtr<wasm_bindgen::__rt::WasmRefCell<grafting_procgen_tileset_wfc::wasm::WfcSolution>>`

### `pub type grafting_procgen_tileset_wfc::wasm::WfcSolution::Anchor = wasm_bindgen::__rt::RcRef<grafting_procgen_tileset_wfc::wasm::WfcSolution>`

### `pub type grafting_procgen_tileset_wfc::wasm::WfcSolution::Anchor = wasm_bindgen::__rt::RcRefMut<grafting_procgen_tileset_wfc::wasm::WfcSolution>`

### `pub unsafe fn grafting_procgen_tileset_wfc::wasm::WfcSolution::from_abi(js: Self::Abi) -> Self`

### `pub unsafe fn grafting_procgen_tileset_wfc::wasm::WfcSolution::long_ref_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_procgen_tileset_wfc::wasm::WfcSolution::ref_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_procgen_tileset_wfc::wasm::WfcSolution::ref_mut_from_abi(js: Self::Abi) -> Self::Anchor`

### `pub unsafe fn grafting_procgen_tileset_wfc::wasm::WfcSolution::vector_from_abi(js: Self::Abi) -> alloc::boxed::Box<[grafting_procgen_tileset_wfc::wasm::WfcSolution]>`
