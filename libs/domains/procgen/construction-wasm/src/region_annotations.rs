//! Everything the session keeps beside the regions rather than in them --
//! pins, pinned curves, property bags -- as one undoable value.

use grafting_graph_core::{ContourTopology, RegionId};

use crate::editing::SessionGraph;
use crate::pins::{PinnedCurves, Pins};
use crate::region_props::RegionProps;

#[derive(Debug, Clone, Default)]
pub struct RegionAnnotations {
    pub pins: Pins,
    pub curves: PinnedCurves,
    pub props: RegionProps,
}

impl RegionAnnotations {
    /// Drops every entry naming something the mutation removed and returns
    /// the live hosts that lost a pinned node, since their cut changes.
    ///
    /// A pin goes with its node or its host; a curve with its edge, or once
    /// its ends are no longer both pinned to its host; a bag with its region.
    pub fn retain_live(
        &mut self,
        topology: &ContourTopology,
        graph: &SessionGraph,
    ) -> Vec<RegionId> {
        let mut orphaned_hosts = Vec::new();
        self.pins.retain(|node, pin| {
            let host_alive = topology.region(&pin.host).is_some();
            if graph.node(node).is_none() {
                if host_alive {
                    orphaned_hosts.push(pin.host.clone());
                }
                return false;
            }
            host_alive
        });
        let pins = &self.pins;
        if pins.is_empty() {
            self.curves.clear();
        } else {
            self.curves.retain(|edge_id, curve| {
                topology.edge(edge_id).is_some_and(|edge| {
                    [edge.start_node(), edge.end_node()]
                        .into_iter()
                        .all(|node| pins.get(node).is_some_and(|pin| pin.host == curve.host))
                })
            });
        }
        self.props
            .retain(|region, _| topology.region(region).is_some());
        orphaned_hosts
    }
}
