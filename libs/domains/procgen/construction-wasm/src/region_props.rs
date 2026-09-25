//! A free-form property bag per region, kept in the undoable state beside
//! the regions it describes. The engine never reads a key; callers own the
//! meaning of every value.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Map, Value};

use grafting_graph_core::{ContourTopology, RegionId};

use crate::mesh::{region_id_from_wire, region_id_to_wire};
use crate::region_editing::RegionEditOutcomeDto;

pub type RegionProps = BTreeMap<RegionId, Map<String, Value>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRegionPropsRequest {
    pub surface_keys: Vec<Vec<String>>,
    pub props: Option<Map<String, Value>>,
}

/// Replaces every named region's bag with `props`, or clears it when
/// `props` is null or empty. Moves nothing; the regions are reported as affected.
pub fn set_region_props(
    topology: &ContourTopology,
    props: &mut RegionProps,
    request: SetRegionPropsRequest,
) -> Result<RegionEditOutcomeDto, String> {
    let mut regions = Vec::with_capacity(request.surface_keys.len());
    for key in &request.surface_keys {
        let region = region_id_from_wire(key)?;
        if topology.region(&region).is_none() {
            return Err(format!("unknown region {region}"));
        }
        regions.push(region);
    }
    let bag = request.props.filter(|bag| !bag.is_empty());
    let mut outcome = RegionEditOutcomeDto::default();
    for region in regions {
        let key = region_id_to_wire(&region);
        match &bag {
            Some(bag) => props.insert(region, bag.clone()),
            None => props.remove(&region),
        };
        if !outcome.affected_surface_keys.contains(&key) {
            outcome.affected_surface_keys.push(key);
        }
    }
    Ok(outcome)
}
