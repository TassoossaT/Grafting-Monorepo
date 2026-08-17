use std::collections::BTreeSet;

use grafting_graph_core::{
    IdentityDelta, LocalInvalidationScope, NodeId, PlanIdentityKind,
    SurfaceKey, TransformationPlan, TransformationPlanFailure,
};
fn node(value: &str) -> NodeId { NodeId::new(value).unwrap() }

#[test]
fn plan_keeps_identity_lifecycles_disjoint_and_local() {
    let created = BTreeSet::from([node("path/new")]);
    let nodes = IdentityDelta::new(PlanIdentityKind::Node, created, BTreeSet::from([node("terrain/boundary")]), BTreeSet::new(), BTreeSet::new()).unwrap();
    let edges = IdentityDelta::new(PlanIdentityKind::Edge, BTreeSet::new(), BTreeSet::new(), BTreeSet::new(), BTreeSet::new()).unwrap();
    let surface = SurfaceKey::from_cycle(&[node("terrain/a"), node("terrain/b"), node("terrain/c")]);
    let surfaces = IdentityDelta::new(PlanIdentityKind::Surface, BTreeSet::from([surface.clone()]), BTreeSet::new(), BTreeSet::new(), BTreeSet::new()).unwrap();
    let plan = TransformationPlan::new(nodes, edges, surfaces, LocalInvalidationScope::new(BTreeSet::from([surface]), BTreeSet::new(), BTreeSet::new())).unwrap();
    assert_eq!(plan.node_ids().preserved().len(), 1);
    assert_eq!(plan.invalidation().changed_surfaces().len(), 1);
}

#[test]
fn overlapping_identity_states_and_empty_plans_fail_without_apply_step() {
    let id = node("same");
    assert_eq!(IdentityDelta::new(PlanIdentityKind::Node, BTreeSet::from([id.clone()]), BTreeSet::from([id]), BTreeSet::new(), BTreeSet::new()), Err(TransformationPlanFailure::OverlappingIdentityStates { kind: PlanIdentityKind::Node }));
    let empty = IdentityDelta::new(PlanIdentityKind::Node, BTreeSet::new(), BTreeSet::new(), BTreeSet::new(), BTreeSet::new()).unwrap();
    let edge = IdentityDelta::new(PlanIdentityKind::Edge, BTreeSet::new(), BTreeSet::new(), BTreeSet::new(), BTreeSet::new()).unwrap();
    let surface = IdentityDelta::new(PlanIdentityKind::Surface, BTreeSet::new(), BTreeSet::new(), BTreeSet::new(), BTreeSet::new()).unwrap();
    assert_eq!(TransformationPlan::new(empty, edge, surface, LocalInvalidationScope::default()), Err(TransformationPlanFailure::NoChanges));
}
