//! Wire shape for `grafting-procgen-solid-field`.
//!
//! Bridge only: parse, call, serialise. The ground arrives as heights on a
//! regular grid of the plane, the shapes as paths with a radius; what comes
//! back is every piece already lifted into world space. Y is height, as
//! everywhere on the tabletop.

use serde::{Deserialize, Serialize};

use grafting_procgen_solid_field::{
    Effect, HeightGrid, Region, Shape, SolidField, SplitOptions, Vec3, lay_ground, shaped_surface,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeightGridDto {
    pub origin_x: f64,
    pub origin_z: f64,
    pub spacing: f64,
    pub columns: usize,
    pub rows: usize,
    /// Row-major, z rows of x columns.
    pub heights: Vec<f64>,
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
pub struct SolidGroundRequest {
    pub ground: HeightGridDto,
    #[serde(default)]
    pub shapes: Vec<ShapeDto>,
    #[serde(default)]
    pub blend: f64,
    pub region_min: [f64; 3],
    pub region_max: [f64; 3],
    pub cell: f64,
    pub face_side: f64,
    /// Face size of the pieces a shape made -- cave, tunnel, bridge. Omitted
    /// lays them at `faceSide`.
    #[serde(default)]
    pub shape_face_side: Option<f64>,
    /// How far over open ground round the shapes a collar of it is laid
    /// with them, for planar ground to meet. Omitted lays none.
    #[serde(default)]
    pub collar: f64,
    #[serde(default = "default_steepest_up")]
    pub steepest_up: f64,
    #[serde(default)]
    pub seed: u32,
}

fn default_steepest_up() -> f64 {
    0.5
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaidPieceDto {
    /// `"up"`, `"down"`, `"east"`, `"west"`, `"north"` or `"south"`.
    pub facing: String,
    pub in_front: usize,
    pub behind: usize,
    /// Ground under open sky with nothing beneath it -- what the height map
    /// alone already is. Every other piece is a shape's.
    pub open_ground: bool,
    pub vertices: Vec<[f64; 3]>,
    pub faces: Vec<Vec<usize>>,
    /// The faces cut into triangles in the piece's own plane: what to draw.
    pub triangles: Vec<[usize; 3]>,
    pub border_point: Vec<Option<usize>>,
    /// Why the piece could not be laid, when it could not.
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolidGroundResponse {
    pub border_points: Vec<[f64; 3]>,
    pub pieces: Vec<LaidPieceDto>,
}

fn point([x, y, z]: [f64; 3]) -> Vec3 {
    Vec3::new(x, y, z)
}

fn array(v: Vec3) -> [f64; 3] {
    [v.x, v.y, v.z]
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolidSurfaceResponse {
    pub vertices: Vec<[f64; 3]>,
    /// Counter-clockwise seen from outside the solid; quads, and a triangle
    /// where only half a grid quad is the shape's.
    pub faces: Vec<Vec<usize>>,
}

/// The field a request describes, and the box it is read in.
fn field_of(request: &SolidGroundRequest, grid: HeightGridDto) -> Result<SolidField<HeightGrid>, String> {
    if grid.columns < 2 || grid.rows < 2 || grid.heights.len() != grid.columns * grid.rows {
        return Err("ground needs columns x rows heights, at least 2 x 2".to_string());
    }
    let mut field = SolidField::new(HeightGrid {
        origin_x: grid.origin_x,
        origin_z: grid.origin_z,
        spacing: grid.spacing,
        columns: grid.columns,
        rows: grid.rows,
        heights: grid.heights,
    });
    field.blend = request.blend;
    for shape in &request.shapes {
        let effect = match shape.effect.as_str() {
            "carve" => Effect::Carve,
            "fill" => Effect::Fill,
            other => return Err(format!("unknown shape effect {other:?}")),
        };
        field.shapes.push(Shape { effect, path: shape.path.iter().copied().map(point).collect(), radius: shape.radius });
    }
    Ok(field)
}

/// Only what the shapes made, and the collar round it, as one quad mesh read
/// at `shapeFaceSide` (or `faceSide`): see `grafting_procgen_solid_field::surface`.
pub fn solid_surface(mut request: SolidGroundRequest) -> Result<SolidSurfaceResponse, String> {
    let side = request.shape_face_side.filter(|side| *side > 0.0).unwrap_or(request.face_side);
    if !(side > 0.0) {
        return Err("faceSide must be positive".to_string());
    }
    let grid = std::mem::replace(&mut request.ground, HeightGridDto { origin_x: 0.0, origin_z: 0.0, spacing: 1.0, columns: 0, rows: 0, heights: Vec::new() });
    let field = field_of(&request, grid)?;
    let region = Region { min: point(request.region_min), max: point(request.region_max), cell: side };
    let options = SplitOptions { steepest_up: request.steepest_up, smallest_piece: side * side, collar: request.collar };
    let mesh = shaped_surface(&field, &region, &options);
    Ok(SolidSurfaceResponse { vertices: mesh.vertices.into_iter().map(array).collect(), faces: mesh.faces })
}

pub fn solid_ground(request: SolidGroundRequest) -> Result<SolidGroundResponse, String> {
    let grid = request.ground;
    if grid.columns < 2 || grid.rows < 2 || grid.heights.len() != grid.columns * grid.rows {
        return Err("ground needs columns x rows heights, at least 2 x 2".to_string());
    }
    if !(request.cell > 0.0) || !(request.face_side > 0.0) {
        return Err("cell and faceSide must be positive".to_string());
    }
    let mut field = SolidField::new(HeightGrid {
        origin_x: grid.origin_x,
        origin_z: grid.origin_z,
        spacing: grid.spacing,
        columns: grid.columns,
        rows: grid.rows,
        heights: grid.heights,
    });
    field.blend = request.blend;
    for shape in request.shapes {
        let effect = match shape.effect.as_str() {
            "carve" => Effect::Carve,
            "fill" => Effect::Fill,
            other => return Err(format!("unknown shape effect {other:?}")),
        };
        field.shapes.push(Shape { effect, path: shape.path.into_iter().map(point).collect(), radius: shape.radius });
    }
    let region = Region { min: point(request.region_min), max: point(request.region_max), cell: request.cell };
    let options = SplitOptions { steepest_up: request.steepest_up, smallest_piece: request.face_side * request.face_side, collar: request.collar };
    let shape_face_side = request.shape_face_side.filter(|side| *side > 0.0).unwrap_or(request.face_side);
    let laid = lay_ground(&field, &region, &options, request.face_side, shape_face_side, request.seed);

    Ok(SolidGroundResponse {
        border_points: laid.border_points.into_iter().map(array).collect(),
        pieces: laid
            .pieces
            .into_iter()
            .map(|(key, result)| {
                let facing = format!("{:?}", key.facing).to_lowercase();
                let open_ground = key.is_open_ground();
                match result {
                    Ok(piece) => LaidPieceDto {
                        facing,
                        in_front: key.in_front,
                        behind: key.behind,
                        open_ground,
                        vertices: piece.vertices.into_iter().map(array).collect(),
                        faces: piece.faces,
                        triangles: piece.triangles,
                        border_point: piece.border_point,
                        error: None,
                    },
                    Err(error) => LaidPieceDto {
                        facing,
                        in_front: key.in_front,
                        behind: key.behind,
                        open_ground,
                        vertices: Vec::new(),
                        faces: Vec::new(),
                        triangles: Vec::new(),
                        border_point: Vec::new(),
                        error: Some(error),
                    },
                }
            })
            .collect(),
    })
}
