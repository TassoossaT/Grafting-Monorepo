//! Chains of upright faces that continue one another through a shared
//! vertical side -- the panels of one wall, straight, cornered or curved --
//! measured as one run.
//!
//! A panel's place on the run is in the same arc-length measure its
//! [`HostFace`] resolves `u` with, so run distance `s` maps to panel
//! `u = (s - offset) / length`, mirrored when the panel runs backwards.

use std::collections::BTreeSet;

use grafting_graph_core::{ContourEdgeId, ContourTopology, NodeId, RegionId};

use crate::host::HostFace;

#[derive(Debug, Clone, PartialEq)]
pub struct RunPanel {
    pub region: RegionId,
    pub offset: f32,
    pub length: f32,
    /// The panel's own `u` runs against the run.
    pub reversed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PanelRun {
    pub panels: Vec<RunPanel>,
    /// The chain comes back round to its first panel.
    pub closed: bool,
}

struct Step {
    region: RegionId,
    face: HostFace,
    reversed: bool,
}

fn face_of(
    topology: &ContourTopology,
    region: &RegionId,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
) -> Option<HostFace> {
    HostFace::of(topology, topology.region(region)?, resolve_position)
}

fn same_column(topology: &ContourTopology, one: &ContourEdgeId, other: &ContourEdgeId) -> bool {
    let (Some(one), Some(other)) = (topology.edge(one), topology.edge(other)) else {
        return false;
    };
    (one.start_node() == other.start_node() && one.end_node() == other.end_node())
        || (one.start_node() == other.end_node() && one.end_node() == other.start_node())
}

/// The one panel continuing `from` across `side`, with the index of its own
/// side there; `None` at a free end, a branch, or a panel that does not
/// join. A side is shared when it is the same edge or joins the same two
/// nodes, since an edge carries at most two faces.
fn neighbour(
    topology: &ContourTopology,
    from: &RegionId,
    side: &ContourEdgeId,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
    joins: &impl Fn(&RegionId) -> bool,
) -> Option<(RegionId, HostFace, usize)> {
    let bottom = topology.edge(side)?.start_node().clone();
    let mut panels = Vec::new();
    for region in topology.regions_touching_node(&bottom) {
        if &region == from {
            continue;
        }
        let Some(face) = face_of(topology, &region, resolve_position) else {
            continue;
        };
        if let Some(entry) = face
            .sides()
            .iter()
            .position(|own| same_column(topology, own, side))
        {
            panels.push((region, face, entry));
        }
    }
    if panels.len() != 1 || !joins(&panels[0].0) {
        return None;
    }
    panels.pop()
}

/// The maximal run through `start`, ordered along `start`'s own `u`. `None`
/// when `start` is not an upright face. Only panels `joins` accepts are
/// added past `start`; the chain stops at a branch (a side shared by three
/// or more upright faces).
pub fn panel_run(
    topology: &ContourTopology,
    start: &RegionId,
    resolve_position: &mut impl FnMut(&NodeId) -> Option<[f32; 3]>,
    joins: impl Fn(&RegionId) -> bool,
) -> Option<PanelRun> {
    let face = face_of(topology, start, resolve_position)?;
    let mut visited = BTreeSet::from([start.clone()]);
    let mut forward = vec![Step {
        region: start.clone(),
        face,
        reversed: false,
    }];
    let mut closed = false;
    loop {
        let last = forward.last()?;
        let exit = last.face.sides()[usize::from(!last.reversed)].clone();
        let Some((region, face, entry)) =
            neighbour(topology, &last.region, &exit, resolve_position, &joins)
        else {
            break;
        };
        if &region == start {
            closed = true;
            break;
        }
        if !visited.insert(region.clone()) {
            break;
        }
        forward.push(Step {
            region,
            face,
            reversed: entry == 1,
        });
    }

    let mut backward: Vec<Step> = Vec::new();
    if !closed {
        let mut exit = forward[0].face.sides()[0].clone();
        let mut from = start.clone();
        while let Some((region, face, entry)) =
            neighbour(topology, &from, &exit, resolve_position, &joins)
        {
            if !visited.insert(region.clone()) {
                break;
            }
            exit = face.sides()[1 - entry].clone();
            from = region.clone();
            backward.push(Step {
                region,
                face,
                reversed: entry == 0,
            });
        }
    }

    let mut offset = 0.0;
    let panels = backward
        .into_iter()
        .rev()
        .chain(forward)
        .map(|step| {
            let length = step.face.length();
            let panel = RunPanel {
                region: step.region,
                offset,
                length,
                reversed: step.reversed,
            };
            offset += length;
            panel
        })
        .collect();
    Some(PanelRun { panels, closed })
}
