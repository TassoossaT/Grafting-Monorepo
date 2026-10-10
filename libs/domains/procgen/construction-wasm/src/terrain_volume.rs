//! Wire shape for `grafting-procgen-solid-field`'s edit of the ground mesh.
//!
//! Bridge only: parse, call, serialise. The faces to lay again and the ground
//! round them arrive as indexed faces; what comes back is the faces laid in
//! their place, every corner of the ring left standing named by the index it
//! arrived with.

use serde::{Deserialize, Serialize};

use grafting_procgen_solid_field::{Brush, FalloffKind, Effect, Faces, Form, Shape, SurfaceEdit, Vec3, edit_surface};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacesDto {
    pub vertices: Vec<[f64; 3]>,
    pub faces: Vec<Vec<usize>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeDto {
    /// `"carve"`, `"fill"`, `"raise"` or `"lower"`.
    pub effect: String,
    pub path: Vec<[f64; 3]>,
    pub radius: f64,
    /// How tall a swept shape is against how wide: `1` round. Omitted is round.
    #[serde(default)]
    pub squash: Option<f64>,
    /// A column over the path's plan between these heights, instead of a swept shape.
    #[serde(default)]
    pub column: Option<ColumnDto>,
    /// For `"raise"` and `"lower"`: how deep the layer is on the path; for `"noise"`, how high its waves are.
    #[serde(default)]
    pub height: Option<f64>,
    /// How much of the effect is laid, `0..=1` (a smooth, a flatten, noise). Omitted: all.
    #[serde(default)]
    pub strength: Option<f64>,
    /// The share of the radius the effect fades over, from the rim in. Omitted: all of it.
    #[serde(default)]
    pub falloff: Option<f64>,
    /// `"smooth"`, `"linear"`, `"spherical"` or `"tip"`. Omitted: smooth.
    #[serde(default)]
    pub falloff_type: Option<String>,
    /// For `"smooth"`: the radius the mean height is read over, as a share of the brush's.
    #[serde(default)]
    pub filter: Option<f64>,
    /// For `"noise"`: how many metres one wave spans.
    #[serde(default)]
    pub noise_scale: Option<f64>,
    #[serde(default)]
    pub seed: Option<u32>,
    /// For `"raise"` and `"lower"`: the way the brush pushes, out of the
    /// surface it was drawn on -- a wall's, a cliff's. Omitted: up, or the
    /// ground's own normal where it folds over.
    #[serde(default)]
    pub direction: Option<[f64; 3]>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDto {
    pub low: f64,
    pub high: f64,
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
    /// The table's height, where new ground may rest on the bare table.
    #[serde(default)]
    pub table: Option<f64>,
    /// Structures standing round the patch: the sides of it they hold are kept.
    #[serde(default = "no_faces")]
    pub neighbours: FacesDto,
}

pub(crate) fn no_faces() -> FacesDto {
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

pub(crate) fn faces(dto: FacesDto) -> Faces {
    Faces { vertices: dto.vertices.into_iter().map(point).collect(), faces: dto.faces }
}

/// The shapes as the solid field takes them.
pub(crate) fn shapes_of(shapes: Vec<ShapeDto>) -> Result<Vec<Shape>, String> {
    shapes
        .into_iter()
        .map(|shape| {
            let effect = match shape.effect.as_str() {
                "carve" => Effect::Carve,
                "fill" => Effect::Fill,
                "raise" => Effect::Raise,
                "lower" => Effect::Lower,
                "smooth" => Effect::Smooth,
                "noise" => Effect::Noise,
                other => return Err(format!("unknown shape effect {other:?}")),
            };
            let form = match (shape.column, shape.height, effect) {
                (_, Some(height), Effect::Raise | Effect::Lower | Effect::Noise) => Form::Profile { height },
                (_, None, Effect::Raise | Effect::Lower | Effect::Noise) => return Err("a raise, lower or noise needs its height".to_string()),
                (_, _, Effect::Smooth) => Form::Profile { height: 0.0 },
                (Some(column), _, _) => Form::Column { low: column.low, high: column.high },
                (None, _, _) => Form::Swept { squash: shape.squash.unwrap_or(1.0) },
            };
            let defaults = Brush::default();
            let kind = match shape.falloff_type.as_deref() {
                None | Some("smooth") => FalloffKind::Smooth,
                Some("linear") => FalloffKind::Linear,
                Some("spherical") => FalloffKind::Spherical,
                Some("tip") => FalloffKind::Tip,
                Some(other) => return Err(format!("unknown falloff type {other:?}")),
            };
            let brush = Brush {
                strength: shape.strength.unwrap_or(defaults.strength),
                falloff: shape.falloff.unwrap_or(defaults.falloff),
                kind,
                filter: shape.filter.unwrap_or(defaults.filter),
                noise_scale: shape.noise_scale.unwrap_or(defaults.noise_scale),
                seed: shape.seed.unwrap_or(defaults.seed),
            };
            let path: Vec<_> = shape.path.into_iter().map(point).collect();
            let up = match shape.direction.map(point) {
                Some(way) if way.length() > 1e-9 => vec![way.normalized(); path.len()],
                _ => Vec::new(),
            };
            Ok(Shape { effect, path, radius: shape.radius, form, up, brush })
        })
        .collect()
}

pub fn edit_terrain_volume(request: TerrainVolumeEditRequest) -> Result<TerrainVolumeEditResponse, String> {
    if !(request.face_side > 0.0) {
        return Err("faceSide must be positive".to_string());
    }
    let shapes = shapes_of(request.shapes)?;
    let edited = edit_surface(
        &faces(request.patch),
        &faces(request.context),
        &SurfaceEdit { shapes, blend: request.blend, face_side: request.face_side, seed: request.seed, table: request.table, neighbours: faces(request.neighbours) },
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
