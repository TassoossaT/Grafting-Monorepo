//! Wire shape for `grafting-procgen-solid-field`'s edit of the ground mesh.
//!
//! Bridge only: parse, call, serialise. The faces to lay again and the ground
//! round them arrive as indexed faces; what comes back is the faces laid in
//! their place, every corner of the ring left standing named by the index it
//! arrived with.

use serde::{Deserialize, Serialize};

use grafting_procgen_solid_field::{Effect, Faces, Shape, SurfaceEdit, Vec3, edit_surface};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacesDto {
    pub vertices: Vec<[f64; 3]>,
    pub faces: Vec<Vec<usize>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeDto {
    /// `"carve"` or `"fill"`.
    pub effect: String,
    pub path: Vec<[f64; 3]>,
    pub radius: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainVolumeEditRequest {
    /// The faces the edit lays again.
    pub patch: FacesDto,
    /// The ground round them: only asked where solid is.
    #[serde(default = "no_faces")]
    pub context: FacesDto,
    pub shapes: Vec<ShapeDto>,
    #[serde(default)]
    pub blend: f64,
    pub face_side: f64,
    #[serde(default)]
    pub seed: u32,
}

fn no_faces() -> FacesDto {
    FacesDto { vertices: Vec::new(), faces: Vec::new() }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainVolumeEditResponse {
    pub vertices: Vec<[f64; 3]>,
    /// In the winding the patch's faces had.
    pub faces: Vec<Vec<usize>>,
    /// Index-aligned with `vertices`: the patch vertex a corner of the ring is.
    pub source: Vec<Option<usize>>,
}

fn point([x, y, z]: [f64; 3]) -> Vec3 {
    Vec3::new(x, y, z)
}

fn faces(dto: FacesDto) -> Faces {
    Faces { vertices: dto.vertices.into_iter().map(point).collect(), faces: dto.faces }
}

pub fn edit_terrain_volume(request: TerrainVolumeEditRequest) -> Result<TerrainVolumeEditResponse, String> {
    if !(request.face_side > 0.0) {
        return Err("faceSide must be positive".to_string());
    }
    let shapes = request
        .shapes
        .into_iter()
        .map(|shape| {
            let effect = match shape.effect.as_str() {
                "carve" => Effect::Carve,
                "fill" => Effect::Fill,
                other => return Err(format!("unknown shape effect {other:?}")),
            };
            Ok(Shape { effect, path: shape.path.into_iter().map(point).collect(), radius: shape.radius })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let edited = edit_surface(
        &faces(request.patch),
        &faces(request.context),
        &SurfaceEdit { shapes, blend: request.blend, face_side: request.face_side, seed: request.seed },
    )?;
    Ok(TerrainVolumeEditResponse {
        vertices: edited.vertices.into_iter().map(|v| [v.x, v.y, v.z]).collect(),
        faces: edited.faces,
        source: edited.source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A second carve into ground a first carve already laid, saved from the
    /// tabletop as it was sent: the ground it reads holds the first tunnel's
    /// own cells, and the grid reads a pinch there two ways.
    #[test]
    fn a_second_carve_into_carved_ground_lays() {
        let request: TerrainVolumeEditRequest = serde_json::from_str(include_str!("../tests/fixtures/second-carve.json")).expect("the fixture parses");
        let out = edit_terrain_volume(request).expect("the edit lays");
        assert!(out.faces.len() > 100, "{} faces", out.faces.len());
        assert!(out.source.iter().any(Option::is_some), "the ring comes back");
    }

    /// Replays a request saved from the tabletop: `VOLUME_EDIT_JSON=<path>`.
    #[test]
    fn replay_a_saved_request() {
        let Ok(path) = std::env::var("VOLUME_EDIT_JSON") else { return };
        let json = std::fs::read_to_string(path).expect("the saved request reads");
        let request: TerrainVolumeEditRequest = serde_json::from_str(&json).expect("the saved request parses");
        match edit_terrain_volume(request) {
            Ok(out) => eprintln!("ok {} faces", out.faces.len()),
            Err(error) => eprintln!("ERR {error}"),
        }
    }
}
