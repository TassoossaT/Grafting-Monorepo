//! Wire shape for `grafting-procgen-solid-field`'s layer laid on the ground,
//! taken off it, or the ground levelled.
//!
//! Bridge only: parse, call, serialise. The request is the volume edit's own
//! (`terrain_volume`); the answer is the regeneration's (`terrain_regenerate`):
//! every corner of the ring named by the patch vertex it is, every new corner
//! on a side of it named with that side's ends.

use serde::Deserialize;

use grafting_procgen_solid_field::{Bed, LayerEdit, layer_surface};

use crate::terrain_regenerate::{LandingDto, OriginDto, TerrainRegenerateResponse};
use crate::terrain_volume::{FacesDto, ShapeDto, faces, no_faces, shapes_of};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainLayerRequest {
    /// The faces the stroke lays again.
    pub patch: FacesDto,
    /// The ground round them: a layer laid on the bare table never covers it.
    #[serde(default = "no_faces")]
    pub context: FacesDto,
    pub shapes: Vec<ShapeDto>,
    #[serde(default)]
    pub blend: f64,
    pub face_side: f64,
    #[serde(default)]
    pub seed: u32,
    /// The table's height, where a layer may run on past the ground onto it.
    #[serde(default)]
    pub table: Option<f64>,
    /// Structures standing round the patch: never covered.
    #[serde(default = "no_faces")]
    pub neighbours: FacesDto,
    /// Structures the ground is brought to rest under, after the shapes.
    #[serde(default)]
    pub beds: Vec<BedDto>,
}

/// One structure's faces and how the ground rests under them (`Bed`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BedDto {
    pub faces: FacesDto,
    pub sink: f64,
    pub below: f64,
    pub above: f64,
    pub margin: f64,
    pub slope: f64,
    pub shoulder: f64,
}

pub fn layer_terrain_surface(
    request: TerrainLayerRequest,
) -> Result<TerrainRegenerateResponse, String> {
    if !(request.face_side > 0.0) {
        return Err("faceSide must be positive".to_string());
    }
    let edit = LayerEdit {
        shapes: shapes_of(request.shapes)?,
        blend: request.blend,
        face_side: request.face_side,
        seed: request.seed,
        table: request.table,
        beds: request
            .beds
            .into_iter()
            .map(|bed| Bed {
                faces: faces(bed.faces),
                sink: bed.sink,
                below: bed.below,
                above: bed.above,
                margin: bed.margin,
                slope: bed.slope,
                shoulder: bed.shoulder,
            })
            .collect(),
    };
    let laid = layer_surface(
        &faces(request.patch),
        &faces(request.context),
        &faces(request.neighbours),
        &edit,
    )?;
    Ok(TerrainRegenerateResponse {
        vertices: laid.vertices.into_iter().map(|v| [v.x, v.y, v.z]).collect(),
        faces: laid.faces,
        origin: laid
            .origin
            .into_iter()
            .map(|origin| origin.map(OriginDto::from))
            .collect(),
        landed: laid
            .landed
            .into_iter()
            .map(|landing| LandingDto {
                vertex: landing.vertex,
                from: landing.from.into(),
                to: landing.to.into(),
            })
            .collect(),
        refinement_complete: laid.refinement_complete,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Replays a request saved from the tabletop: `LAYER_JSON=<path>`.
    #[test]
    fn replay_a_saved_request() {
        let Ok(path) = std::env::var("LAYER_JSON") else {
            return;
        };
        let request: TerrainLayerRequest =
            serde_json::from_str(&std::fs::read_to_string(path).expect("reads")).expect("parses");
        let started = std::time::Instant::now();
        match layer_terrain_surface(request) {
            Ok(out) => eprintln!("ok {} faces in {:?}", out.faces.len(), started.elapsed()),
            Err(error) => eprintln!("ERR {error}"),
        }
    }
}
