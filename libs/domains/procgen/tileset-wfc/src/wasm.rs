//! The Web boundary: a flat, typed-array ABI over the solver-agnostic model.
//!
//! Everything crossing this boundary is a number. There is no socket type, no
//! module struct and -- most importantly -- no third-party solver type, which
//! is what lets the engine be replaced without any JavaScript changing. The
//! caller describes a graph and a tileset as integers and gets integers back.
//!
//! # Why the shape is what it is
//!
//! Variable-length structures are expressed as a flat array plus a stride,
//! rather than as objects, because crossing the boundary once with a
//! `Uint32Array` costs a memory copy while crossing it per module costs a call
//! per module. The grids this serves have thousands of cells.
//!
//! Panics are not catchable on `wasm32-unknown-unknown`, so every argument is
//! validated here and reported as a thrown `Error` -- the same discipline the
//! sibling procgen bridges document. An invalid input must reject, not abort
//! the caller's worker.

use wasm_bindgen::prelude::*;

use crate::graph::{CellGraph, Link};
use crate::problem::Problem;
use crate::rotation::Rotation;
use crate::tileset::{Module, ModuleId, Tileset};

/// Numbers per link in the flat `links` array: from, from_face, to, to_face.
pub const LINK_STRIDE: usize = 4;

/// Numbers per entry in the flat `compatible` array: the two socket ids.
pub const COMPATIBLE_STRIDE: usize = 2;

/// Numbers per entry in the flat `pinned` array: the cell, then one module it
/// is still permitted to take.
pub const PINNED_STRIDE: usize = 2;

/// One solved map, as parallel arrays indexed by cell.
///
/// `source` and `turns` are the answer a renderer actually needs: which
/// authored module's mesh to draw, and how far to spin it. They are returned
/// rather than the caller re-deriving them, because the expansion that
/// produced the variants happened on this side of the boundary.
#[wasm_bindgen]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WfcSolution {
    modules: Vec<u32>,
    sources: Vec<u32>,
    turns: Vec<u32>,
    variant_count: u32,
}

#[wasm_bindgen]
impl WfcSolution {
    /// The chosen variant per cell, indexing the expanded tileset.
    #[wasm_bindgen(getter)]
    pub fn modules(&self) -> Vec<u32> {
        self.modules.clone()
    }

    /// The authored module per cell, indexing the array the caller supplied.
    #[wasm_bindgen(getter)]
    pub fn sources(&self) -> Vec<u32> {
        self.sources.clone()
    }

    /// How many turns to apply to that module's mesh, per cell.
    #[wasm_bindgen(getter)]
    pub fn turns(&self) -> Vec<u32> {
        self.turns.clone()
    }

    /// How many variants the authored modules expanded into. Useful for
    /// telling "my tileset is too small" apart from "my constraints are wrong".
    #[wasm_bindgen(getter, js_name = variantCount)]
    pub fn variant_count(&self) -> u32 {
        self.variant_count
    }
}

/// Solves a tile assignment over an arbitrary cell graph.
///
/// * `cell_count`, `faces_per_cell` -- the graph's shape. A face index is
///   local to its cell; see [`crate::graph`] for why that is the whole point.
/// * `links` -- adjacency, `LINK_STRIDE` numbers each, each undirected
///   adjacency listed once.
/// * `module_sockets` -- `faces_per_cell` socket ids per authored module,
///   concatenated; its length divided by `faces_per_cell` is the module count.
/// * `module_weights` -- one positive weight per authored module. A module's
///   weight is shared across the orientations it expands into, so making a
///   piece asymmetric does not make it more common.
/// * `compatible` -- socket pairs that may meet, `COMPATIBLE_STRIDE` each.
///   Symmetric: listing `(a, b)` also permits `(b, a)`.
/// * `rotation_cycle` -- face indices that rotate among themselves, in order.
///   Empty means modules are used exactly as authored. For a stacked quad grid
///   this is the four lateral faces, leaving up and down alone.
/// * `pinned` -- `(cell, module)` pairs restricting a cell to the authored
///   modules listed for it. A cell absent here may take anything. This is how
///   an earlier pipeline stage imposes what it already decided.
/// * `seed` -- the same seed and the same inputs give the same map.
///
/// # Errors
///
/// Throws with a message naming the offending cell, link or module. Known-
/// impossible problems are rejected during compilation rather than handed to
/// the solver, which would otherwise search for an unbounded time.
#[wasm_bindgen(js_name = solveTileset)]
#[allow(clippy::too_many_arguments)]
pub fn solve_tileset(
    cell_count: u32,
    faces_per_cell: u32,
    links: &[u32],
    module_sockets: &[u32],
    module_weights: &[f32],
    compatible: &[u32],
    rotation_cycle: &[u32],
    pinned: &[u32],
    seed: u32,
) -> Result<WfcSolution, JsValue> {
    solve_inner(
        cell_count,
        faces_per_cell,
        links,
        module_sockets,
        module_weights,
        compatible,
        rotation_cycle,
        pinned,
        seed,
    )
    .map_err(|message| JsValue::from_str(&message))
}

/// The boundary's body, as a plain `Result<_, String>`.
///
/// Split out so it is reachable from a native test. A bridge that can only be
/// exercised in a browser is a bridge nobody tests.
#[allow(clippy::too_many_arguments)]
pub fn solve_inner(
    cell_count: u32,
    faces_per_cell: u32,
    links: &[u32],
    module_sockets: &[u32],
    module_weights: &[f32],
    compatible: &[u32],
    rotation_cycle: &[u32],
    pinned: &[u32],
    seed: u32,
) -> Result<WfcSolution, String> {
    let cell_count = cell_count as usize;
    let faces_per_cell = faces_per_cell as usize;
    if faces_per_cell == 0 {
        return Err("faces_per_cell must be at least 1".into());
    }
    if links.len() % LINK_STRIDE != 0 {
        return Err(format!("links must hold a multiple of {LINK_STRIDE} numbers"));
    }
    if compatible.len() % COMPATIBLE_STRIDE != 0 {
        return Err(format!("compatible must hold a multiple of {COMPATIBLE_STRIDE} numbers"));
    }
    if pinned.len() % PINNED_STRIDE != 0 {
        return Err(format!("pinned must hold a multiple of {PINNED_STRIDE} numbers"));
    }
    if module_sockets.len() % faces_per_cell != 0 {
        return Err(format!(
            "module_sockets holds {} numbers, which is not a whole number of modules at \
             {faces_per_cell} faces each",
            module_sockets.len(),
        ));
    }
    let module_count = module_sockets.len() / faces_per_cell;
    if module_count != module_weights.len() {
        return Err(format!(
            "module_sockets describes {module_count} modules but {} weights were given",
            module_weights.len(),
        ));
    }

    let modules: Vec<Module> = (0..module_count)
        .map(|index| Module {
            name: index.to_string(),
            sockets: module_sockets[index * faces_per_cell..(index + 1) * faces_per_cell]
                .iter()
                .map(|&socket| socket as usize)
                .collect(),
            weight: module_weights[index],
        })
        .collect();

    let rotation = Rotation::cycle(rotation_cycle.iter().map(|&face| face as usize))
        .map_err(|error| error.to_string())?;
    for &face in rotation.faces() {
        if face >= faces_per_cell {
            return Err(format!(
                "rotation_cycle names face {face}, but cells have {faces_per_cell} faces",
            ));
        }
    }

    let tileset = Tileset::rotated(
        modules,
        compatible
            .chunks_exact(COMPATIBLE_STRIDE)
            .map(|pair| (pair[0] as usize, pair[1] as usize)),
        &rotation,
    )
    .map_err(|error| error.to_string())?;

    let graph = CellGraph::new(
        cell_count,
        faces_per_cell,
        links.chunks_exact(LINK_STRIDE).map(|link| Link {
            from: link[0] as usize,
            from_face: link[1] as usize,
            to: link[2] as usize,
            to_face: link[3] as usize,
        }),
    )
    .map_err(|error| error.to_string())?;

    // A pin names an *authored* module, since that is what the caller holds;
    // it has to admit every orientation that module expanded into, or pinning
    // a rotatable piece would silently mean "only its unrotated form".
    let mut restrictions: Vec<Option<Vec<ModuleId>>> = vec![None; cell_count];
    for entry in pinned.chunks_exact(PINNED_STRIDE) {
        let (cell, source) = (entry[0] as usize, entry[1] as usize);
        if cell >= cell_count {
            return Err(format!("pinned refers to cell {cell}, but there are {cell_count}"));
        }
        if source >= module_count {
            return Err(format!(
                "pinned refers to module {source}, but {module_count} were given",
            ));
        }
        let variants: Vec<ModuleId> = (0..tileset.modules().len())
            .filter(|&id| tileset.origin(id).is_some_and(|origin| origin.source == source))
            .collect();
        restrictions[cell].get_or_insert_with(Vec::new).extend(variants);
    }
    let pinned: Vec<(usize, Vec<ModuleId>)> = restrictions
        .into_iter()
        .enumerate()
        .filter_map(|(cell, allowed)| allowed.map(|allowed| (cell, allowed)))
        .collect();

    let problem = Problem::compile(&graph, &tileset, &pinned).map_err(|error| error.to_string())?;
    let assignment = run(&problem, u64::from(seed))?;

    let mut sources = Vec::with_capacity(cell_count);
    let mut turns = Vec::with_capacity(cell_count);
    for &module in assignment.iter() {
        let origin = problem
            .origins()
            .get(module)
            .ok_or_else(|| format!("the solver returned unknown module {module}"))?;
        sources.push(origin.source as u32);
        turns.push(origin.turns as u32);
    }

    Ok(WfcSolution {
        modules: assignment.iter().map(|&module| module as u32).collect(),
        sources,
        turns,
        variant_count: tileset.modules().len() as u32,
    })
}

/// Runs whichever backend this build enabled.
///
/// The only place in the bridge that knows a backend exists at all. Adding a
/// second engine is an arm here plus a module under `backend/`; no signature
/// above this line changes, and nothing in JavaScript does.
fn run(problem: &Problem, seed: u64) -> Result<Vec<ModuleId>, String> {
    #[cfg(feature = "solver-wfc")]
    {
        let solver = crate::backend::wfc::WaveFunctionCollapseSolver;
        crate::solver::solve_verified(&solver, problem, seed)
            .map(|assignment| assignment.modules().to_vec())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(feature = "solver-wfc"))]
    {
        let _ = (problem, seed);
        Err("this build has no constraint solver enabled".into())
    }
}
