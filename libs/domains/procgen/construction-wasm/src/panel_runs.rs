//! The run of upright panels a region lies across, as the wire reports it.
//! The run geometry itself is `grafting-procgen-surface-mesh`'s [`panel_run`].

use serde::{Deserialize, Serialize};

use grafting_graph_core::{ContourTopology, RegionId, SurfaceRegistry};
use grafting_procgen_surface_mesh::run::panel_run;

use crate::editing::SessionGraph;
use crate::mesh::{region_id_from_wire, region_id_to_wire};
use crate::pins::{SurfaceCapabilities, capability_of};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelRunRequest {
    pub surface_key: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPanelDto {
    pub surface_key: Vec<String>,
    pub offset: f32,
    pub length: f32,
    pub reversed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelRunDto {
    pub panels: Vec<RunPanelDto>,
    pub closed: bool,
}

/// The run of cuttable upright panels through the requested one. An error
/// when that panel is not upright or does not accept cuts itself.
pub fn panel_run_of(
    graph: &SessionGraph,
    topology: &ContourTopology,
    surfaces: &SurfaceRegistry,
    capabilities: &SurfaceCapabilities,
    request: PanelRunRequest,
) -> Result<PanelRunDto, String> {
    let start = region_id_from_wire(&request.surface_key)?;
    if topology.region(&start).is_none() {
        return Err(format!("unknown region {start}"));
    }
    let joins = |region: &RegionId| capability_of(capabilities, surfaces, region).accepts_cuts;
    if !joins(&start) {
        return Err(format!("region {start} does not accept cuts"));
    }
    let run = panel_run(
        topology,
        &start,
        &mut |id| graph.node(id).map(|node| *node.data()),
        joins,
    )
    .ok_or_else(|| format!("region {start} is not an upright panel"))?;
    Ok(PanelRunDto {
        panels: run
            .panels
            .into_iter()
            .map(|panel| RunPanelDto {
                surface_key: region_id_to_wire(&panel.region),
                offset: panel.offset,
                length: panel.length,
                reversed: panel.reversed,
            })
            .collect(),
        closed: run.closed,
    })
}
