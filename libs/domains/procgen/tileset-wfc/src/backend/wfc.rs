//! The `wave-function-collapse` backend.
//!
//! This module is the only place in the repository that names that crate. It
//! translates our [`Problem`] into that crate's vocabulary and translates the
//! result back; nothing leaks in either direction. Replacing it means writing
//! a sibling module and flipping a feature -- no caller changes.
//!
//! Why this crate was chosen over `ghx_proc_gen`, which the research
//! originally selected: its constraints are declared per neighbour pair rather
//! than per global direction. `ghx_proc_gen`'s solver requires that the
//! neighbour of `n` in direction `d` has `n` as its neighbour in the opposite
//! direction, with direction indices fixed globally -- a labelling our
//! irregular grid provably does not admit. Nothing here needs directions at
//! all.

use std::collections::HashMap;

use wave_function_collapse::wave_function::{
    Node, NodeStateCollection, WaveFunction,
    collapsable_wave_function::{
        collapsable_wave_function::CollapsableWaveFunction,
        entropic_collapsable_wave_function::EntropicCollapsableWaveFunction,
    },
};

use crate::problem::Problem;
use crate::solver::{Assignment, ConstraintSolver, SolveError};
use crate::tileset::ModuleId;

/// A [`ConstraintSolver`] backed by the `wave-function-collapse` crate.
#[derive(Debug, Clone, Copy, Default)]
pub struct WaveFunctionCollapseSolver;

/// That crate identifies nodes and states by string. Ours are indices, so the
/// mapping is fixed and total here rather than being invented per call site.
fn cell_id(cell: usize) -> String {
    format!("c{cell}")
}

fn state_id(module: ModuleId) -> String {
    format!("m{module}")
}

fn module_of(state: &str) -> Option<ModuleId> {
    state.strip_prefix('m')?.parse().ok()
}

fn cell_of(id: &str) -> Option<usize> {
    id.strip_prefix('c')?.parse().ok()
}

impl ConstraintSolver for WaveFunctionCollapseSolver {
    fn solve(&self, problem: &Problem, seed: u64) -> Result<Assignment, SolveError> {
        // A "node state collection" says: if this node is in state S, the
        // neighbour may only be in these states. We need one per (link,
        // direction, state-of-origin), which is why they are keyed by all
        // three.
        let mut collections = Vec::new();
        let mut per_cell_neighbours: Vec<HashMap<String, Vec<String>>> =
            vec![HashMap::new(); problem.cell_count()];

        for (index, link) in problem.links().iter().enumerate() {
            let mut forward: HashMap<ModuleId, Vec<String>> = HashMap::new();
            let mut backward: HashMap<ModuleId, Vec<String>> = HashMap::new();
            for &(left, right) in &link.allowed {
                forward.entry(left).or_default().push(state_id(right));
                backward.entry(right).or_default().push(state_id(left));
            }

            // A candidate with no partner across this link cannot be used at
            // all; recording an empty permission set is how that is expressed.
            let mut push_side = |from: usize,
                                 to: usize,
                                 side: &str,
                                 permitted: &HashMap<ModuleId, Vec<String>>| {
                let mut ids = Vec::new();
                for &module in problem.candidates(from) {
                    let id = format!("l{index}{side}s{module}");
                    let mut allowed = permitted.get(&module).cloned().unwrap_or_default();
                    allowed.sort();
                    collections.push(NodeStateCollection::new(
                        id.clone(),
                        state_id(module),
                        allowed,
                    ));
                    ids.push(id);
                }
                per_cell_neighbours[from].insert(cell_id(to), ids);
            };

            push_side(link.from, link.to, "f", &forward);
            push_side(link.to, link.from, "b", &backward);
        }

        let nodes: Vec<Node<String>> = (0..problem.cell_count())
            .map(|cell| {
                let ratios: HashMap<String, f32> = problem
                    .candidates(cell)
                    .iter()
                    .map(|&module| (state_id(module), problem.weights()[module]))
                    .collect();
                Node::new(
                    cell_id(cell),
                    ratios,
                    core::mem::take(&mut per_cell_neighbours[cell]),
                )
            })
            .collect();

        let wave = WaveFunction::new(nodes, collections);
        wave.validate()
            .map_err(|detail| SolveError::Contradiction { detail })?;

        let mut collapsable: EntropicCollapsableWaveFunction<String> =
            wave.get_collapsable_wave_function(Some(seed));
        let collapsed = collapsable
            .collapse()
            .map_err(|detail| SolveError::Contradiction { detail })?;

        let mut modules = vec![usize::MAX; problem.cell_count()];
        for (id, state) in collapsed.node_state_per_node_id {
            let (Some(cell), Some(module)) = (cell_of(&id), module_of(&state)) else {
                continue;
            };
            if let Some(slot) = modules.get_mut(cell) {
                *slot = module;
            }
        }
        Ok(Assignment::new(modules))
    }
}
