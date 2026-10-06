//! Wire shape for `grafting-procgen-solid-field`'s regeneration of a patch of
//! ground on its own surface.
//!
//! Bridge only: parse, call, serialise. The patch arrives as indexed faces,
//! the structures' rings as points the caller names; what comes back is the
//! faces laid in the patch's place, every corner that already was something
//! named by what it was, and every new corner lying on a side somebody holds
//! named with that side's two ends.

use serde::{Deserialize, Serialize};

use grafting_procgen_solid_field::{Faces, GivenPoint, Origin, Regeneration, Vec3, regenerate_surface};

use crate::terrain_volume::FacesDto;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GivenPointDto {
    pub position: [f64; 3],
    /// The caller's own name for the point: an index into a table it keeps.
    pub id: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainRegenerateRequest {
    /// The faces laid again: a disk, holes allowed.
    pub patch: FacesDto,
    /// Closed rings where structures rest on the ground: no ground inside.
    #[serde(default)]
    pub holes: Vec<Vec<GivenPointDto>>,
    pub face_side: f64,
    #[serde(default)]
    pub seed: u32,
    #[serde(default = "standard_relax")]
    pub relax_strength: f64,
}

fn standard_relax() -> f64 {
    0.7
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "index")]
pub enum OriginDto {
    Patch(usize),
    Given(usize),
}

impl From<Origin> for OriginDto {
    fn from(origin: Origin) -> Self {
        match origin {
            Origin::Patch(index) => Self::Patch(index),
            Origin::Given(id) => Self::Given(id),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LandingDto {
    pub vertex: usize,
    pub from: OriginDto,
    pub to: OriginDto,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainRegenerateResponse {
    pub vertices: Vec<[f64; 3]>,
    /// In the winding the patch's faces had.
    pub faces: Vec<Vec<usize>>,
    /// Index-aligned with `vertices`.
    pub origin: Vec<Option<OriginDto>>,
    pub landed: Vec<LandingDto>,
    pub refinement_complete: bool,
}

fn point([x, y, z]: [f64; 3]) -> Vec3 {
    Vec3::new(x, y, z)
}

pub fn regenerate_terrain_surface(request: TerrainRegenerateRequest) -> Result<TerrainRegenerateResponse, String> {
    if !(request.face_side > 0.0) {
        return Err("faceSide must be positive".to_string());
    }
    let patch = Faces { vertices: request.patch.vertices.into_iter().map(point).collect(), faces: request.patch.faces };
    let regeneration = Regeneration {
        holes: request
            .holes
            .into_iter()
            .map(|ring| ring.into_iter().map(|given| GivenPoint { position: point(given.position), id: given.id }).collect())
            .collect(),
        face_side: request.face_side,
        seed: request.seed,
        relax_strength: request.relax_strength,
    };
    let laid = regenerate_surface(&patch, &regeneration)?;
    Ok(TerrainRegenerateResponse {
        vertices: laid.vertices.into_iter().map(|v| [v.x, v.y, v.z]).collect(),
        faces: laid.faces,
        origin: laid.origin.into_iter().map(|origin| origin.map(OriginDto::from)).collect(),
        landed: laid.landed.into_iter().map(|landing| LandingDto { vertex: landing.vertex, from: landing.from.into(), to: landing.to.into() }).collect(),
        refinement_complete: laid.refinement_complete,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_square_of_ground_round_a_floor_comes_back_over_the_wire() {
        let json = r#"{
            "patch": {
                "vertices": [[-4,0,-4],[0,0,-4],[4,0,-4],[-4,0,0],[0,0,0],[4,0,0],[-4,0,4],[0,0,4],[4,0,4]],
                "faces": [[0,3,4,1],[1,4,5,2],[3,6,7,4],[4,7,8,5]]
            },
            "holes": [[
                {"position": [-1,0,-1], "id": 40},
                {"position": [1,0,-1], "id": 41},
                {"position": [1,0,1], "id": 42},
                {"position": [-1,0,1], "id": 43}
            ]],
            "faceSide": 1.0,
            "seed": 3
        }"#;
        let request: TerrainRegenerateRequest = serde_json::from_str(json).expect("parses");
        let out = regenerate_terrain_surface(request).expect("lays");
        let text = serde_json::to_string(&out).expect("serialises");
        assert!(text.contains(r#"{"kind":"given","index":40}"#), "{text}");
        assert!(text.contains(r#"{"kind":"patch","index":0}"#), "{text}");
        assert!(out.faces.len() > 10);
    }
}
