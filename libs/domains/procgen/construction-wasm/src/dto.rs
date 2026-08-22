//! Shared wire-format conversion crossing the JSON boundary: a
//! deterministic [`RegionId`] derived from the node cycle a generator
//! produced.

use grafting_graph_core::{NodeId, RegionId};

/// Derives a stable, reproducible [`RegionId`] from a node cycle, in the
/// cycle's own order -- a region's loop is an oriented boundary, and every
/// real generator in this crate emits the same cycle order for the same
/// geometry on repeat calls. That is what makes `diff_apply.rs`'s
/// repaint-is-a-no-op behavior work: identical geometry across ticks
/// derives the exact same identity.
pub fn region_id_from_cycle(cycle: &[NodeId]) -> Result<RegionId, String> {
    if cycle.is_empty() {
        return Err("a surface cycle must reference at least one node".to_string());
    }
    let joined = cycle
        .iter()
        .map(NodeId::as_str)
        .collect::<Vec<_>>()
        .join("|");
    RegionId::new(joined).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nid(name: &str) -> NodeId {
        NodeId::new(name).unwrap()
    }

    #[test]
    fn a_region_id_is_derived_from_the_cycle_in_its_own_order() {
        let forward = region_id_from_cycle(&[nid("a"), nid("b"), nid("c")]).unwrap();
        let same = region_id_from_cycle(&[nid("a"), nid("b"), nid("c")]).unwrap();
        assert_eq!(forward, same, "identical geometry derives one identity");

        let rotated = region_id_from_cycle(&[nid("b"), nid("c"), nid("a")]).unwrap();
        assert_ne!(
            forward, rotated,
            "a loop is an oriented boundary, not an unordered set"
        );
    }

    #[test]
    fn an_empty_cycle_has_no_region_identity() {
        assert!(region_id_from_cycle(&[]).is_err());
    }
}
