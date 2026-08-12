//! Domain operations combining [`Graph`] mutation with [`SurfaceRegistry`]
//! bookkeeping, per `ADR-0022`: `Move`, `Delete` (with the general
//! cycle-repair algorithm), `Merge`, and `Split`. `Duplicate` is deferred
//! to a follow-up: unlike `Merge`/`Split`, it needs the caller to also
//! supply new edges (`Surface` does not track which edges form its
//! boundary, so there is nothing to duplicate automatically), a genuinely
//! different shape of problem from the other four.

use std::collections::{BTreeSet, HashMap};
use std::error::Error;
use std::fmt;

use crate::{Graph, GraphError, Node, NodeId, SurfaceError, SurfaceKey, SurfaceRegistry, SurfaceType};

/// Structural error from a domain-level construction operation -- either
/// the graph mutation or the surface bookkeeping it coordinates can fail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConstructionError {
    /// The underlying graph query or mutation failed.
    Graph(GraphError),
    /// The underlying surface registry mutation failed.
    Surface(SurfaceError),
    /// [`merge_surfaces`] or [`split_surface`] was asked to treat the same
    /// node-set identity as two distinct operands.
    SameSurface {
        /// The identity that was supplied twice.
        key: SurfaceKey,
    },
}

impl fmt::Display for ConstructionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Graph(error) => write!(formatter, "{error}"),
            Self::Surface(error) => write!(formatter, "{error}"),
            Self::SameSurface { key } => {
                write!(formatter, "expected two distinct surfaces, both were {key:?}")
            }
        }
    }
}

impl Error for ConstructionError {}

impl From<GraphError> for ConstructionError {
    fn from(error: GraphError) -> Self {
        Self::Graph(error)
    }
}

impl From<SurfaceError> for ConstructionError {
    fn from(error: SurfaceError) -> Self {
        Self::Surface(error)
    }
}

/// Moves a node by applying `update` to its payload, then reports every
/// surface that referenced it and therefore needs its mesh recomputed --
/// the reactive-redraw behavior `ADR-0022` describes for `Move`. Always
/// safe: moving a node never changes graph topology or surface membership,
/// so this cannot fail for any reason but the node not existing.
pub fn move_node<N, E>(
    graph: &mut Graph<N, E>,
    surfaces: &SurfaceRegistry,
    id: &NodeId,
    update: impl FnOnce(&mut N),
) -> Result<Vec<SurfaceKey>, GraphError> {
    let node = graph
        .node_mut(id)
        .ok_or_else(|| GraphError::UnknownNode { id: id.clone() })?;
    update(node.data_mut());
    Ok(surfaces.surfaces_referencing(id).cloned().collect())
}

/// Outcome of [`delete_node`].
#[derive(Debug)]
pub struct DeleteOutcome<N> {
    /// The deleted node's payload.
    pub removed_node: Node<N>,
    /// Surfaces removed because their cycle included the deleted node.
    pub removed_surfaces: Vec<SurfaceKey>,
    /// New surfaces generated to cap a hole -- one per simple cycle found
    /// among the deleted node's former neighbors, per `ADR-0022`'s general
    /// cycle-repair algorithm.
    pub capping_surfaces: Vec<SurfaceKey>,
}

/// Deletes a node and repairs the hole it leaves, per `ADR-0022`'s general
/// cycle-repair algorithm:
///
/// 1. Every surface referencing the deleted node is removed.
/// 2. The node (and its edges) is removed from the graph.
/// 3. Each connected component of the induced subgraph on the deleted
///    node's former neighbors -- using only edges that already existed
///    directly between them, collapsing any multi-edge between the same
///    pair to one logical adjacency -- is checked: if every node in that
///    component has degree exactly 2 within it (a connected 2-regular
///    subgraph, which is always exactly one simple cycle), a new surface
///    is generated to cap it, via `cap_surface`. A component that is not a
///    clean cycle (a branch, an open path) is left as an accepted hole --
///    not an error, and not searched for a sub-cycle within it (confirmed
///    scope with the repository owner: no general cycle search inside an
///    irregular component).
///
/// `cap_surface` receives each found cycle's nodes, in traversal order,
/// and returns the `(SurfaceType, physical)` the new capping surface
/// should have -- this crate does not decide domain semantics.
///
/// Every candidate capping surface is checked against `surfaces` for a
/// node-set collision with an already-registered, unrelated surface
/// *before* anything is mutated, so a collision fails the whole operation
/// atomically rather than leaving the node removed with only some of its
/// capping surfaces registered.
pub fn delete_node<N, E>(
    graph: &mut Graph<N, E>,
    surfaces: &mut SurfaceRegistry,
    id: &NodeId,
    mut cap_surface: impl FnMut(&[NodeId]) -> (SurfaceType, bool),
) -> Result<DeleteOutcome<N>, ConstructionError> {
    let mut neighbors: BTreeSet<NodeId> = graph.successors(id)?.into_iter().collect();
    neighbors.extend(graph.predecessors(id)?);

    // Induced subgraph on `neighbors`, using only edges that will survive
    // `id`'s removal -- computed now, without mutating anything yet, by
    // simply excluding `id` itself from each neighbor's own adjacency.
    let mut induced: HashMap<NodeId, BTreeSet<NodeId>> = HashMap::new();
    for neighbor in &neighbors {
        let mut adjacent: BTreeSet<NodeId> = graph.successors(neighbor)?.into_iter().collect();
        adjacent.extend(graph.predecessors(neighbor)?);
        adjacent.retain(|candidate| neighbors.contains(candidate));
        induced.insert(neighbor.clone(), adjacent);
    }

    let mut planned_caps: Vec<(Vec<NodeId>, SurfaceType, bool)> = Vec::new();
    let mut visited: BTreeSet<NodeId> = BTreeSet::new();
    for start in &neighbors {
        if visited.contains(start) {
            continue;
        }
        let component = connected_component(&induced, start);
        visited.extend(component.iter().cloned());

        if let Some(cycle) = simple_cycle_order(&induced, &component) {
            let (surface_type, physical) = cap_surface(&cycle);
            let key = SurfaceKey::from_cycle(&cycle);
            if surfaces.surface(&key).is_some() {
                return Err(ConstructionError::Surface(SurfaceError::DuplicateSurface { key }));
            }
            planned_caps.push((cycle, surface_type, physical));
        }
    }

    // Validated: commit the mutation.
    let removed_surfaces = surfaces.surfaces_referencing(id).cloned().collect::<Vec<_>>();
    for key in &removed_surfaces {
        surfaces
            .remove_surface(key)
            .expect("surfaces_referencing only returns keys that are registered");
    }
    let removed_node = graph.remove_node(id)?;

    let mut capping_surfaces = Vec::with_capacity(planned_caps.len());
    for (cycle, surface_type, physical) in planned_caps {
        let key = surfaces
            .add_surface(graph, cycle, surface_type, physical)
            .expect("pre-validated: cycle nodes exist, cycle is non-empty, identity does not collide");
        capping_surfaces.push(key);
    }

    Ok(DeleteOutcome {
        removed_node,
        removed_surfaces,
        capping_surfaces,
    })
}

fn connected_component(induced: &HashMap<NodeId, BTreeSet<NodeId>>, start: &NodeId) -> BTreeSet<NodeId> {
    let mut component = BTreeSet::new();
    let mut stack = vec![start.clone()];
    while let Some(current) = stack.pop() {
        if !component.insert(current.clone()) {
            continue;
        }
        if let Some(adjacent) = induced.get(&current) {
            stack.extend(adjacent.iter().cloned());
        }
    }
    component
}

/// If every node in `component` has degree exactly 2 within `induced`,
/// traces the single cycle it forms (a connected 2-regular graph is always
/// exactly one simple cycle) and returns it in traversal order. Returns
/// `None` for a branch, an open path, or an isolated node -- anything that
/// is not a clean, closed cycle.
fn simple_cycle_order(induced: &HashMap<NodeId, BTreeSet<NodeId>>, component: &BTreeSet<NodeId>) -> Option<Vec<NodeId>> {
    if component.len() < 3 {
        return None;
    }
    for node in component {
        if induced.get(node).map(BTreeSet::len) != Some(2) {
            return None;
        }
    }

    let start = component.iter().next()?.clone();
    let mut ordered = vec![start.clone()];
    let mut previous = start.clone();
    let mut current = induced[&start].iter().next()?.clone();
    while current != start {
        ordered.push(current.clone());
        let next = induced[&current]
            .iter()
            .find(|candidate| **candidate != previous)
            .expect("a degree-2 node always has an unvisited neighbor to continue the walk")
            .clone();
        previous = current;
        current = next;
    }

    debug_assert_eq!(
        ordered.len(),
        component.len(),
        "a connected, all-degree-2 component is always exactly one simple cycle"
    );
    Some(ordered)
}

/// A surface's non-identity attributes, for operations that register a new
/// surface as one step of a larger operation ([`merge_surfaces`],
/// [`split_surface`]) rather than standalone via
/// [`SurfaceRegistry::add_surface`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurfaceSpec {
    /// Nodes forming the new surface's cycle, in mesh-derivation order.
    pub cycle: Vec<NodeId>,
    /// The new surface's open, extensible type identifier.
    pub surface_type: SurfaceType,
    /// Whether the new surface blocks movement or acts as ground.
    pub physical: bool,
}

/// Validates a candidate new surface without registering it: non-empty
/// cycle, every node exists, and its node-set identity does not collide
/// with an already-registered surface -- except a key listed in `exclude`,
/// which the caller is about to remove as part of the same operation, so a
/// resulting identity match against it is expected, not a collision.
fn validate_new_surface<N, E>(
    graph: &Graph<N, E>,
    surfaces: &SurfaceRegistry,
    spec: &SurfaceSpec,
    exclude: &[&SurfaceKey],
) -> Result<SurfaceKey, SurfaceError> {
    if spec.cycle.is_empty() {
        return Err(SurfaceError::EmptyCycle);
    }
    for id in &spec.cycle {
        if graph.node(id).is_none() {
            return Err(SurfaceError::UnknownNode { id: id.clone() });
        }
    }
    let key = SurfaceKey::from_cycle(&spec.cycle);
    if !exclude.contains(&&key) && surfaces.surface(&key).is_some() {
        return Err(SurfaceError::DuplicateSurface { key });
    }
    Ok(key)
}

/// Unites two existing surfaces into one new surface, per `ADR-0022`'s
/// `Merge` ("a door's nodes and an adjoining wall's nodes becoming one
/// thing"). `merged` is the caller-supplied result -- only the domain
/// knows the correct combined boundary, this crate does not compute
/// geometry. Both `a` and `b` must already be registered and distinct;
/// `merged` is validated (existing nodes, non-empty, no collision with an
/// unrelated third surface) *before* `a` and `b` are removed, so a failure
/// never leaves either original surface gone without its replacement.
pub fn merge_surfaces<N, E>(
    graph: &Graph<N, E>,
    surfaces: &mut SurfaceRegistry,
    a: &SurfaceKey,
    b: &SurfaceKey,
    merged: SurfaceSpec,
) -> Result<SurfaceKey, ConstructionError> {
    if a == b {
        return Err(ConstructionError::SameSurface { key: a.clone() });
    }
    if surfaces.surface(a).is_none() {
        return Err(SurfaceError::UnknownSurface { key: a.clone() }.into());
    }
    if surfaces.surface(b).is_none() {
        return Err(SurfaceError::UnknownSurface { key: b.clone() }.into());
    }
    validate_new_surface(graph, surfaces, &merged, &[a, b])?;

    surfaces.remove_surface(a).expect("checked above");
    surfaces.remove_surface(b).expect("checked above");
    Ok(surfaces
        .add_surface(graph, merged.cycle, merged.surface_type, merged.physical)
        .expect("pre-validated by validate_new_surface"))
}

/// Divides one existing surface into two new surfaces, per `ADR-0022`'s
/// `Split` ("cutting a wall into two"). `first` and `second` are the
/// caller-supplied halves -- only the domain knows how to cut the
/// geometry, this crate does not compute it. `key` must already be
/// registered; both halves are validated, and checked not to collide with
/// *each other*, before `key` is removed -- a failure never leaves the
/// original surface gone with only one (or neither) half registered.
pub fn split_surface<N, E>(
    graph: &Graph<N, E>,
    surfaces: &mut SurfaceRegistry,
    key: &SurfaceKey,
    first: SurfaceSpec,
    second: SurfaceSpec,
) -> Result<(SurfaceKey, SurfaceKey), ConstructionError> {
    if surfaces.surface(key).is_none() {
        return Err(SurfaceError::UnknownSurface { key: key.clone() }.into());
    }
    let first_key = validate_new_surface(graph, surfaces, &first, &[key])?;
    let second_key = validate_new_surface(graph, surfaces, &second, &[key])?;
    if first_key == second_key {
        return Err(ConstructionError::SameSurface { key: first_key });
    }

    surfaces.remove_surface(key).expect("checked above");
    let first_registered = surfaces
        .add_surface(graph, first.cycle, first.surface_type, first.physical)
        .expect("pre-validated by validate_new_surface");
    let second_registered = surfaces
        .add_surface(graph, second.cycle, second.surface_type, second.physical)
        .expect("pre-validated by validate_new_surface");
    Ok((first_registered, second_registered))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Edge, EdgeId, Node};

    fn node(id: &str) -> Node<[f32; 3]> {
        Node::new(NodeId::new(id).unwrap(), [0.0, 0.0, 0.0])
    }

    fn undirected_edge(id: &str, a: &str, b: &str) -> Edge<()> {
        Edge::new(EdgeId::new(id).unwrap(), NodeId::new(a).unwrap(), NodeId::new(b).unwrap(), ())
    }

    fn nid(name: &str) -> NodeId {
        NodeId::new(name).unwrap()
    }

    /// A pyramid: apex "tip" connected to 4 base nodes forming a ring
    /// among themselves ("no base surface" per the ADR's own example --
    /// only the 4 side faces plus the apex-to-base edges exist here).
    fn pyramid() -> Graph<[f32; 3], ()> {
        Graph::try_from_parts(
            vec![node("tip"), node("a"), node("b"), node("c"), node("d")],
            vec![
                undirected_edge("tip-a", "tip", "a"),
                undirected_edge("tip-b", "tip", "b"),
                undirected_edge("tip-c", "tip", "c"),
                undirected_edge("tip-d", "tip", "d"),
                undirected_edge("ab", "a", "b"),
                undirected_edge("bc", "b", "c"),
                undirected_edge("cd", "c", "d"),
                undirected_edge("da", "d", "a"),
            ],
        )
        .unwrap()
    }

    #[test]
    fn move_node_reports_only_referencing_surfaces() {
        let mut graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let side_ta = surfaces
            .add_surface(&graph, vec![nid("tip"), nid("a"), nid("b")], SurfaceType::new("wall"), true)
            .unwrap();
        let _unrelated = surfaces
            .add_surface(&graph, vec![nid("b"), nid("c"), nid("d")], SurfaceType::new("wall"), true)
            .unwrap();

        let affected = move_node(&mut graph, &surfaces, &nid("tip"), |position| position[2] = 5.0).unwrap();
        assert_eq!(affected, vec![side_ta]);
        assert_eq!(graph.node(&nid("tip")).unwrap().data()[2], 5.0);

        assert_eq!(
            move_node(&mut graph, &surfaces, &nid("missing"), |_| {}).unwrap_err(),
            GraphError::UnknownNode { id: nid("missing") }
        );
    }

    #[test]
    fn delete_node_caps_the_base_cycle_left_by_the_apex() {
        let mut graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let side_faces = [
            surfaces.add_surface(&graph, vec![nid("tip"), nid("a"), nid("b")], SurfaceType::new("wall"), true).unwrap(),
            surfaces.add_surface(&graph, vec![nid("tip"), nid("b"), nid("c")], SurfaceType::new("wall"), true).unwrap(),
            surfaces.add_surface(&graph, vec![nid("tip"), nid("c"), nid("d")], SurfaceType::new("wall"), true).unwrap(),
            surfaces.add_surface(&graph, vec![nid("tip"), nid("d"), nid("a")], SurfaceType::new("wall"), true).unwrap(),
        ];

        let outcome = delete_node(&mut graph, &mut surfaces, &nid("tip"), |_cycle| (SurfaceType::new("floor"), true)).unwrap();

        let mut removed = outcome.removed_surfaces.clone();
        removed.sort();
        let mut expected_removed = side_faces.to_vec();
        expected_removed.sort();
        assert_eq!(removed, expected_removed);

        assert_eq!(outcome.capping_surfaces.len(), 1);
        let cap = surfaces.surface(&outcome.capping_surfaces[0]).unwrap();
        assert_eq!(cap.surface_type(), &SurfaceType::new("floor"));
        assert_eq!(
            SurfaceKey::from_cycle(cap.cycle()),
            SurfaceKey::from_cycle(&[nid("a"), nid("b"), nid("c"), nid("d")])
        );

        assert!(graph.node(&nid("tip")).is_none());
        for face in &side_faces {
            assert!(surfaces.surface(face).is_none());
        }
    }

    #[test]
    fn delete_node_generates_two_surfaces_for_two_pyramids_sharing_one_apex() {
        // Two pyramids sharing the apex "tip": base {a,b,c,d} and base
        // {e,f,g,h}, no edges between the two bases -- the exact case the
        // repository owner confirmed while specifying the algorithm.
        let mut graph = Graph::try_from_parts(
            vec![node("tip"), node("a"), node("b"), node("c"), node("d"), node("e"), node("f"), node("g"), node("h")],
            vec![
                undirected_edge("tip-a", "tip", "a"),
                undirected_edge("tip-b", "tip", "b"),
                undirected_edge("tip-c", "tip", "c"),
                undirected_edge("tip-d", "tip", "d"),
                undirected_edge("ab", "a", "b"),
                undirected_edge("bc", "b", "c"),
                undirected_edge("cd", "c", "d"),
                undirected_edge("da", "d", "a"),
                undirected_edge("tip-e", "tip", "e"),
                undirected_edge("tip-f", "tip", "f"),
                undirected_edge("tip-g", "tip", "g"),
                undirected_edge("tip-h", "tip", "h"),
                undirected_edge("ef", "e", "f"),
                undirected_edge("fg", "f", "g"),
                undirected_edge("gh", "g", "h"),
                undirected_edge("he", "h", "e"),
            ],
        )
        .unwrap();
        let mut surfaces = SurfaceRegistry::new();

        let outcome = delete_node(&mut graph, &mut surfaces, &nid("tip"), |_cycle| (SurfaceType::new("floor"), true)).unwrap();

        assert_eq!(outcome.capping_surfaces.len(), 2);
        let mut capped_keys = outcome
            .capping_surfaces
            .iter()
            .map(|key| surfaces.surface(key).unwrap().cycle().iter().cloned().collect::<BTreeSet<_>>())
            .collect::<Vec<_>>();
        capped_keys.sort_by_key(|set| set.iter().next().cloned());
        assert_eq!(
            capped_keys,
            vec![
                [nid("a"), nid("b"), nid("c"), nid("d")].into_iter().collect(),
                [nid("e"), nid("f"), nid("g"), nid("h")].into_iter().collect(),
            ]
        );
    }

    #[test]
    fn delete_node_leaves_a_hole_when_neighbors_do_not_form_a_clean_cycle() {
        // "b" has an extra chord to "tip" removed leaves a branch: base
        // ring a-b-c-d plus an extra spoke node "x" hanging off "b" --
        // "b" then has degree 3 in the induced subgraph (a, c, x), so no
        // clean cycle exists and nothing should be generated.
        let mut graph = Graph::try_from_parts(
            vec![node("tip"), node("a"), node("b"), node("c"), node("d"), node("x")],
            vec![
                undirected_edge("tip-a", "tip", "a"),
                undirected_edge("tip-b", "tip", "b"),
                undirected_edge("tip-c", "tip", "c"),
                undirected_edge("tip-d", "tip", "d"),
                undirected_edge("ab", "a", "b"),
                undirected_edge("bc", "b", "c"),
                undirected_edge("cd", "c", "d"),
                undirected_edge("da", "d", "a"),
                undirected_edge("bx", "b", "x"),
                undirected_edge("tip-x", "tip", "x"),
            ],
        )
        .unwrap();
        let mut surfaces = SurfaceRegistry::new();

        let outcome = delete_node(&mut graph, &mut surfaces, &nid("tip"), |_cycle| (SurfaceType::new("floor"), true)).unwrap();

        assert!(outcome.capping_surfaces.is_empty());
    }

    #[test]
    fn delete_node_rejects_unknown_node_without_mutating_anything() {
        let mut graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let existing = surfaces
            .add_surface(&graph, vec![nid("tip"), nid("a"), nid("b")], SurfaceType::new("wall"), true)
            .unwrap();

        let error = delete_node(&mut graph, &mut surfaces, &nid("missing"), |_cycle| (SurfaceType::new("floor"), true))
            .unwrap_err();
        assert_eq!(error, ConstructionError::Graph(GraphError::UnknownNode { id: nid("missing") }));
        assert!(graph.node(&nid("tip")).is_some());
        assert!(surfaces.surface(&existing).is_some());
    }

    #[test]
    fn delete_node_rejects_a_cap_that_collides_with_an_unrelated_surface_without_mutating_anything() {
        let mut graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        // An unrelated, pre-existing surface that happens to occupy the
        // exact same node set the base cycle would need for its cap.
        let unrelated = surfaces
            .add_surface(&graph, vec![nid("a"), nid("b"), nid("c"), nid("d")], SurfaceType::new("existing-floor"), true)
            .unwrap();
        let side = surfaces
            .add_surface(&graph, vec![nid("tip"), nid("a"), nid("b")], SurfaceType::new("wall"), true)
            .unwrap();

        let error = delete_node(&mut graph, &mut surfaces, &nid("tip"), |_cycle| (SurfaceType::new("floor"), true))
            .unwrap_err();
        assert_eq!(
            error,
            ConstructionError::Surface(SurfaceError::DuplicateSurface {
                key: SurfaceKey::from_cycle(&[nid("a"), nid("b"), nid("c"), nid("d")])
            })
        );
        // Nothing committed: the node, and both pre-existing surfaces, are untouched.
        assert!(graph.node(&nid("tip")).is_some());
        assert!(surfaces.surface(&unrelated).is_some());
        assert!(surfaces.surface(&side).is_some());
    }

    fn spec(nodes: &[&str], surface_type: &str, physical: bool) -> SurfaceSpec {
        SurfaceSpec {
            cycle: nodes.iter().map(|name| nid(name)).collect(),
            surface_type: SurfaceType::new(surface_type),
            physical,
        }
    }

    #[test]
    fn merge_surfaces_unites_two_into_one() {
        let graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let side_ab = surfaces.add_surface(&graph, vec![nid("tip"), nid("a"), nid("b")], SurfaceType::new("wall"), true).unwrap();
        let side_bc = surfaces.add_surface(&graph, vec![nid("tip"), nid("b"), nid("c")], SurfaceType::new("wall"), true).unwrap();

        let merged_key = merge_surfaces(&graph, &mut surfaces, &side_ab, &side_bc, spec(&["tip", "a", "b", "c"], "merged-wall", true)).unwrap();

        assert!(surfaces.surface(&side_ab).is_none());
        assert!(surfaces.surface(&side_bc).is_none());
        let merged = surfaces.surface(&merged_key).unwrap();
        assert_eq!(merged.surface_type(), &SurfaceType::new("merged-wall"));
        assert_eq!(SurfaceKey::from_cycle(merged.cycle()), SurfaceKey::from_cycle(&[nid("tip"), nid("a"), nid("b"), nid("c")]));
    }

    #[test]
    fn merge_surfaces_rejects_the_same_surface_twice() {
        let graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let side = surfaces.add_surface(&graph, vec![nid("tip"), nid("a"), nid("b")], SurfaceType::new("wall"), true).unwrap();

        let error = merge_surfaces(&graph, &mut surfaces, &side, &side, spec(&["tip", "a", "b", "c"], "merged", true)).unwrap_err();
        assert_eq!(error, ConstructionError::SameSurface { key: side.clone() });
        assert!(surfaces.surface(&side).is_some());
    }

    #[test]
    fn merge_surfaces_rejects_unknown_operand_without_mutating_anything() {
        let graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let side = surfaces.add_surface(&graph, vec![nid("tip"), nid("a"), nid("b")], SurfaceType::new("wall"), true).unwrap();
        let missing = SurfaceKey::from_cycle(&[nid("tip"), nid("c"), nid("d")]);

        let error = merge_surfaces(&graph, &mut surfaces, &side, &missing, spec(&["tip", "a", "b", "c"], "merged", true)).unwrap_err();
        assert_eq!(error, ConstructionError::Surface(SurfaceError::UnknownSurface { key: missing }));
        assert!(surfaces.surface(&side).is_some());
    }

    #[test]
    fn merge_surfaces_rejects_a_result_colliding_with_a_third_surface_without_mutating_anything() {
        let graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let side_ab = surfaces.add_surface(&graph, vec![nid("tip"), nid("a"), nid("b")], SurfaceType::new("wall"), true).unwrap();
        let side_bc = surfaces.add_surface(&graph, vec![nid("tip"), nid("b"), nid("c")], SurfaceType::new("wall"), true).unwrap();
        let unrelated = surfaces.add_surface(&graph, vec![nid("a"), nid("b"), nid("c"), nid("d")], SurfaceType::new("floor"), true).unwrap();

        let error = merge_surfaces(&graph, &mut surfaces, &side_ab, &side_bc, spec(&["a", "b", "c", "d"], "merged", true)).unwrap_err();
        assert_eq!(error, ConstructionError::Surface(SurfaceError::DuplicateSurface { key: unrelated.clone() }));
        assert!(surfaces.surface(&side_ab).is_some());
        assert!(surfaces.surface(&side_bc).is_some());
        assert!(surfaces.surface(&unrelated).is_some());
    }

    #[test]
    fn split_surface_divides_one_into_two() {
        let graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let merged = surfaces.add_surface(&graph, vec![nid("tip"), nid("a"), nid("b"), nid("c")], SurfaceType::new("merged-wall"), true).unwrap();

        let (first, second) = split_surface(
            &graph,
            &mut surfaces,
            &merged,
            spec(&["tip", "a", "b"], "wall", true),
            spec(&["tip", "b", "c"], "wall", true),
        )
        .unwrap();

        assert!(surfaces.surface(&merged).is_none());
        assert_eq!(SurfaceKey::from_cycle(surfaces.surface(&first).unwrap().cycle()), SurfaceKey::from_cycle(&[nid("tip"), nid("a"), nid("b")]));
        assert_eq!(SurfaceKey::from_cycle(surfaces.surface(&second).unwrap().cycle()), SurfaceKey::from_cycle(&[nid("tip"), nid("b"), nid("c")]));
    }

    #[test]
    fn split_surface_rejects_unknown_surface() {
        let graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let missing = SurfaceKey::from_cycle(&[nid("tip"), nid("a")]);

        let error = split_surface(&graph, &mut surfaces, &missing, spec(&["tip", "a"], "wall", true), spec(&["b", "c"], "wall", true)).unwrap_err();
        assert_eq!(error, ConstructionError::Surface(SurfaceError::UnknownSurface { key: missing }));
    }

    #[test]
    fn split_surface_rejects_two_halves_with_the_same_identity() {
        let graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let merged = surfaces.add_surface(&graph, vec![nid("tip"), nid("a"), nid("b"), nid("c")], SurfaceType::new("merged-wall"), true).unwrap();

        let error = split_surface(
            &graph,
            &mut surfaces,
            &merged,
            spec(&["tip", "a", "b"], "wall", true),
            spec(&["b", "a", "tip"], "wall", true),
        )
        .unwrap_err();
        assert_eq!(error, ConstructionError::SameSurface { key: SurfaceKey::from_cycle(&[nid("tip"), nid("a"), nid("b")]) });
        // Nothing committed: the original surface is still there.
        assert!(surfaces.surface(&merged).is_some());
    }

    #[test]
    fn split_surface_rejects_a_half_colliding_with_a_third_surface_without_mutating_anything() {
        let graph = pyramid();
        let mut surfaces = SurfaceRegistry::new();
        let merged = surfaces.add_surface(&graph, vec![nid("tip"), nid("a"), nid("b"), nid("c")], SurfaceType::new("merged-wall"), true).unwrap();
        let unrelated = surfaces.add_surface(&graph, vec![nid("tip"), nid("b"), nid("c")], SurfaceType::new("wall"), true).unwrap();

        let error = split_surface(
            &graph,
            &mut surfaces,
            &merged,
            spec(&["tip", "a", "b"], "wall", true),
            spec(&["tip", "b", "c"], "wall", true),
        )
        .unwrap_err();
        assert_eq!(error, ConstructionError::Surface(SurfaceError::DuplicateSurface { key: unrelated.clone() }));
        assert!(surfaces.surface(&merged).is_some());
        assert!(surfaces.surface(&unrelated).is_some());
    }
}
