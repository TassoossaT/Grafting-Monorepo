//! Type-independent, finite motion propagation and atomic spatial updates.
use crate::{ContourGeometry, ContourTopology, Graph, NodeId, RegionEditOutcome};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

/// An absolute position in a consolidated edit.
#[derive(Debug, Clone, PartialEq)]
pub struct NodeMotion {
    /// Existing graph identity.
    pub node_id: NodeId,
    /// Requested spatial position.
    pub position: [f32; 3],
}

/// A seed displacement. Zero axes carry no displacement demand.
#[derive(Debug, Clone)]
pub struct RequestedMotion {
    /// Existing graph identity.
    pub node_id: NodeId,
    /// Displacement from the consistent input state.
    pub delta: [f32; 3],
}

/// A caller-declared response; no product type is stored here.
#[derive(Debug, Clone)]
pub struct MotionInfluence {
    /// Node receiving a displacement.
    pub from: NodeId,
    /// Node which must receive that displacement on selected axes.
    pub to: NodeId,
    /// X, Y, Z propagation mask.
    pub axes: [bool; 3],
}

/// A motion rejected before any mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MotionError {
    /// A request references an absent node.
    UnknownNode(NodeId),
    /// A displacement or resulting coordinate is not finite.
    NonFinite(NodeId),
    /// Two paths demand different displacements or positions.
    Conflict(NodeId),
    /// A registered contour is invalid.
    InvalidTopology(String),
}
impl std::fmt::Display for MotionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "motion rejected: {self:?}")
    }
}
impl std::error::Error for MotionError {}

/// Immutable result, sorted by identity, with work counters for profiling.
#[derive(Debug, Clone)]
pub struct MotionPlan {
    /// Each affected node appears exactly once.
    pub moves: Vec<NodeMotion>,
    /// Resolved node/axis pairs (at most three per affected node).
    pub resolved_axes: usize,
    /// Influence/axis visits, including converging paths.
    pub visited_influences: usize,
}

/// Resolves directed influences without mutating the graph.
/// Each node/axis is queued once. Equal cycles converge, conflicting cycles
/// fail. Exact equality is deliberate: copied displacements are identical,
/// whereas approximate equality would make convergence order-dependent.
pub fn plan_motion<E>(
    graph: &Graph<[f32; 3], E>,
    seeds: &[RequestedMotion],
    influences: &[MotionInfluence],
) -> Result<MotionPlan, MotionError> {
    let mut adjacency: BTreeMap<&NodeId, Vec<&MotionInfluence>> = BTreeMap::new();
    for link in influences {
        for id in [&link.from, &link.to] {
            if graph.node(id).is_none() {
                return Err(MotionError::UnknownNode(id.clone()));
            }
        }
        adjacency.entry(&link.from).or_default().push(link);
    }
    let mut demands: BTreeMap<(NodeId, usize), f32> = BTreeMap::new();
    let mut queue = VecDeque::new();
    fn demand(
        demands: &mut BTreeMap<(NodeId, usize), f32>,
        queue: &mut VecDeque<(NodeId, usize)>,
        id: &NodeId,
        axis: usize,
        delta: f32,
    ) -> Result<(), MotionError> {
        if !delta.is_finite() {
            return Err(MotionError::NonFinite(id.clone()));
        }
        if delta == 0.0 {
            return Ok(());
        }
        let key = (id.clone(), axis);
        if let Some(previous) = demands.get(&key) {
            if *previous != delta {
                return Err(MotionError::Conflict(id.clone()));
            }
        } else {
            demands.insert(key.clone(), delta);
            queue.push_back(key);
        }
        Ok(())
    }
    for seed in seeds {
        if graph.node(&seed.node_id).is_none() {
            return Err(MotionError::UnknownNode(seed.node_id.clone()));
        }
        for axis in 0..3 {
            demand(
                &mut demands,
                &mut queue,
                &seed.node_id,
                axis,
                seed.delta[axis],
            )?;
        }
    }
    let mut visits = 0;
    while let Some((id, axis)) = queue.pop_front() {
        let delta = demands[&(id.clone(), axis)];
        for link in adjacency.get(&id).into_iter().flatten() {
            if link.axes[axis] {
                visits += 1;
                demand(&mut demands, &mut queue, &link.to, axis, delta)?;
            }
        }
    }
    let mut positions: BTreeMap<NodeId, [f32; 3]> = BTreeMap::new();
    for ((id, axis), delta) in &demands {
        let position = positions
            .entry(id.clone())
            .or_insert_with(|| *graph.node(id).unwrap().data());
        position[*axis] += delta;
        if !position.iter().all(|v| v.is_finite()) {
            return Err(MotionError::NonFinite(id.clone()));
        }
    }
    Ok(MotionPlan {
        moves: positions
            .into_iter()
            .map(|(node_id, position)| NodeMotion { node_id, position })
            .collect(),
        resolved_axes: demands.len(),
        visited_influences: visits,
    })
}

/// Validates the whole batch before writing; invalid batches leave the graph
/// untouched. Contours are scanned once for the entire batch, so outcome
/// collection does not repeat a global incidence query for each moved node.
pub fn move_vertices<E>(
    graph: &mut Graph<[f32; 3], E>,
    topology: &mut ContourTopology,
    moves: &[NodeMotion],
) -> Result<RegionEditOutcome, MotionError> {
    let mut positions = BTreeMap::new();
    for motion in moves {
        if graph.node(&motion.node_id).is_none() {
            return Err(MotionError::UnknownNode(motion.node_id.clone()));
        }
        if !motion.position.iter().all(|v| v.is_finite()) {
            return Err(MotionError::NonFinite(motion.node_id.clone()));
        }
        if let Some(previous) = positions.insert(motion.node_id.clone(), motion.position) {
            if previous != motion.position {
                return Err(MotionError::Conflict(motion.node_id.clone()));
            }
        }
    }
    let mut translated_arcs = Vec::new();
    for edge_id in topology.edge_ids() {
        let edge = topology.edge(&edge_id).unwrap();
        let ContourGeometry::CircularArc { center, clockwise } = edge.geometry() else {
            continue;
        };
        if !positions.contains_key(edge.start_node()) && !positions.contains_key(edge.end_node()) {
            continue;
        }
        let original_start = graph.node(edge.start_node()).unwrap().data();
        let original_end = graph.node(edge.end_node()).unwrap().data();
        let start = positions.get(edge.start_node()).unwrap_or(original_start);
        let end = positions.get(edge.end_node()).unwrap_or(original_end);
        if start[0] == original_start[0]
            && start[2] == original_start[2]
            && end[0] == original_end[0]
            && end[2] == original_end[2]
        {
            continue;
        }
        let old = [
            (original_end[0] - original_start[0]) as f64,
            (original_end[2] - original_start[2]) as f64,
        ];
        let new = [(end[0] - start[0]) as f64, (end[2] - start[2]) as f64];
        let length_sq = old[0] * old[0] + old[1] * old[1];
        if length_sq < 1e-10 || new[0] * new[0] + new[1] * new[1] < 1e-10 {
            return Err(MotionError::InvalidTopology(
                "an arc cannot collapse to a zero-length chord".into(),
            ));
        }
        // Similarity of the old chord to the new one preserves the arc's sweep.
        // This also handles a single endpoint edit; rigid translation is its
        // scale=1, rotation=0 case. Undo applies the inverse similarity.
        let scale_cos = (old[0] * new[0] + old[1] * new[1]) / length_sq;
        let scale_sin = (old[0] * new[1] - old[1] * new[0]) / length_sq;
        let relative = [
            (center[0] - original_start[0]) as f64,
            (center[1] - original_start[2]) as f64,
        ];
        let center = [
            (start[0] as f64 + scale_cos * relative[0] - scale_sin * relative[1]) as f32,
            (start[2] as f64 + scale_sin * relative[0] + scale_cos * relative[1]) as f32,
        ];
        if !center.iter().all(|v| v.is_finite()) {
            return Err(MotionError::NonFinite(edge.start_node().clone()));
        }
        translated_arcs.push((
            edge_id,
            ContourGeometry::CircularArc {
                center,
                clockwise: *clockwise,
            },
        ));
    }
    let mut affected = BTreeSet::new();
    for region in topology.region_ids() {
        let nodes = topology
            .region_nodes(&region)
            .map_err(|e| MotionError::InvalidTopology(e.to_string()))?;
        if nodes.iter().any(|id| positions.contains_key(id)) {
            affected.insert(region);
        }
    }
    for (id, position) in positions {
        *graph.node_mut(&id).unwrap().data_mut() = position;
    }
    for (id, geometry) in translated_arcs {
        topology
            .set_edge_geometry(&id, geometry)
            .expect("edge was validated in the same exclusive borrow");
    }
    Ok(RegionEditOutcome {
        affected_regions: affected.into_iter().collect(),
        ..Default::default()
    })
}
