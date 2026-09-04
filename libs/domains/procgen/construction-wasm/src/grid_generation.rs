//! Wire shape for `grafting-procgen-irregular-grid`.
//!
//! Bridge only, like the rest of this crate: parse, call, serialise. Every
//! decision below the JSON -- what the lattice spacing is, how big a triangle
//! the refinement may leave, which faces are ground -- belongs to the grid
//! crate and is not restated here.
//!
//! **The one translation this module does own** is the plane. The app speaks
//! XZ, because Y is height on the tabletop; the grid crate speaks a bare
//! plane with no opinion about which world axes it maps to. `z` goes to `y`
//! on the way in and back on the way out, and no height crosses this boundary
//! in either direction -- the caller samples that for itself, for the corners
//! it already had and for the ones it is told are new.

use serde::{Deserialize, Serialize};

use grafting_procgen_irregular_grid::constrained::{ConstrainedOptions, ConstraintPoint};
use grafting_procgen_irregular_grid::hex::{lattice_covering, lattice_triangle_area};
use grafting_procgen_irregular_grid::mesh::Vec2;
use grafting_procgen_irregular_grid::{RelaxOptions, build_constrained_quad_grid};

/// One point of a contour, on the ground plane.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintPointDto {
    pub x: f64,
    pub z: f64,
    /// The caller index for the node already standing here, if one is.
    ///
    /// An index into a table the caller keeps, never a node id: this crate
    /// forwards it untouched and the grid crate never looks inside it, so
    /// neither of them has to know what a `ConstructionNodeId` is.
    #[serde(default)]
    pub source: Option<u32>,
}

/// How square the refinement is asked to keep its triangles, and how many
/// points it may spend getting there.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefinementDto {
    pub min_angle_degrees: f64,
    pub max_additional_vertices: usize,
}

impl Default for RefinementDto {
    fn default() -> Self {
        Self { min_angle_degrees: 30.0, max_additional_vertices: 50_000 }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelaxDto {
    pub iterations: u32,
    pub strength: f64,
}

impl Default for RelaxDto {
    fn default() -> Self {
        let standard = RelaxOptions::standard();
        Self { iterations: standard.iterations, strength: standard.strength }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrregularQuadGridRequest {
    pub seed: u32,
    /// Closed rings bounding the ground to generate.
    pub boundary: Vec<Vec<ConstraintPointDto>>,
    /// Closed rings of ground other clouds already hold, subtracted from it.
    #[serde(default)]
    pub holes: Vec<Vec<ConstraintPointDto>>,
    /// The lattice side -- the one knob that sets the cell scale, matching
    /// the unconstrained generator own `triangleSide`.
    pub triangle_side: f64,
    #[serde(default)]
    pub refinement: RefinementDto,
    #[serde(default)]
    pub relax: RelaxDto,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GridVertexDto {
    pub x: f64,
    pub z: f64,
    /// The `source` this corner arrived with, or `null` for new ground.
    pub source: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrregularQuadGridResponse {
    pub vertices: Vec<GridVertexDto>,
    pub quads: Vec<[usize; 4]>,
    /// Indices of corners that sit on a supplied contour but had no source --
    /// nodes the cloud owning that contour has to adopt.
    pub on_contour: Vec<usize>,
    /// `false` where the refinement stopped at its vertex budget; the mesh is
    /// usable but coarser somewhere.
    pub refinement_complete: bool,
}

fn rings_of(rings: &[Vec<ConstraintPointDto>]) -> Vec<Vec<ConstraintPoint>> {
    rings
        .iter()
        .map(|ring| {
            ring.iter()
                .map(|point| ConstraintPoint {
                    position: Vec2::new(point.x, point.z),
                    source: point.source,
                })
                .collect()
        })
        .collect()
}

/// The box every supplied ring fits inside, which is what the seed lattice
/// has to cover. `None` where no ring holds a usable point.
fn bounds_of(rings: &[Vec<ConstraintPoint>]) -> Option<(Vec2, Vec2)> {
    let mut min = Vec2::new(f64::MAX, f64::MAX);
    let mut max = Vec2::new(f64::MIN, f64::MIN);
    let mut any = false;
    for point in rings.iter().flatten().map(|entry| entry.position) {
        if !point.x.is_finite() || !point.y.is_finite() {
            continue;
        }
        min = Vec2::new(min.x.min(point.x), min.y.min(point.y));
        max = Vec2::new(max.x.max(point.x), max.y.max(point.y));
        any = true;
    }
    if any { Some((min, max)) } else { None }
}

/// Generates one grid. Pure: nothing here touches the session graph.
///
/// Kept pure on purpose. Applying the result needs node ids minted for the
/// new corners and a height sampled for each, neither of which this side
/// knows anything about -- and the application already owns a validated way
/// to register geometry (`add_patch`). Generating and applying in one call,
/// the way `generate_and_apply_*` does, would mean reproducing that
/// id-and-height decision down here where the type that makes it does not
/// exist.
pub fn irregular_quad_grid(
    request: IrregularQuadGridRequest,
) -> Result<IrregularQuadGridResponse, String> {
    if !(request.triangle_side > 0.0) {
        return Err("triangleSide must be a positive number".to_string());
    }
    let boundary = rings_of(&request.boundary);
    if boundary.iter().all(|ring| ring.len() < 3) {
        return Err("boundary needs at least one ring of three or more points".to_string());
    }
    let holes = rings_of(&request.holes);

    let (min, max) = bounds_of(&boundary).ok_or("boundary holds no usable point")?;

    let options = ConstrainedOptions {
        seeds: lattice_covering(min, max, request.triangle_side),
        boundary,
        holes,
        seed_clearance: request.triangle_side * 0.25,
        max_area: lattice_triangle_area(request.triangle_side),
        min_angle_degrees: request.refinement.min_angle_degrees,
        max_additional_vertices: request.refinement.max_additional_vertices,
    };

    let relax = RelaxOptions {
        iterations: request.relax.iterations,
        strength: request.relax.strength,
        // Never the outer boundary: it is already held in place by being a
        // constraint, and pinning it twice would also pin the contour corners
        // the caller wants relaxed nowhere else.
        pin_boundary: false,
        pinned_targets: Default::default(),
    };

    let grid = build_constrained_quad_grid(&options, request.seed, &relax)
        .ok_or("the supplied contours describe no ground that can be triangulated")?;

    Ok(IrregularQuadGridResponse {
        vertices: grid
            .mesh
            .vertices
            .iter()
            .enumerate()
            .map(|(index, vertex)| GridVertexDto {
                x: vertex.x,
                z: vertex.y,
                source: grid.sources[index],
            })
            .collect(),
        quads: grid.mesh.quads,
        on_contour: grid.on_contour,
        refinement_complete: grid.refinement_complete,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 10x10 field with a road across its middle, in the wire shape the
    /// application actually sends -- XZ, camelCase, `source` where a node
    /// already stands.
    fn request_json(holes: &str) -> String {
        format!(
            r#"{{
              "seed": 7,
              "triangleSide": 0.5,
              "boundary": [[
                {{"x": 0, "z": 0, "source": 0}},
                {{"x": 10, "z": 0, "source": 1}},
                {{"x": 10, "z": 10, "source": 2}},
                {{"x": 0, "z": 10, "source": 3}}
              ]],
              "holes": {holes}
            }}"#
        )
    }

    fn generate(holes: &str) -> IrregularQuadGridResponse {
        let request: IrregularQuadGridRequest =
            serde_json::from_str(&request_json(holes)).expect("the wire shape parses");
        irregular_quad_grid(request).expect("a grid")
    }

    #[test]
    fn the_wire_shape_parses_with_only_its_required_fields() {
        // `holes`, `refinement` and `relax` all default. A caller creating
        // ground on empty land should not have to say anything about
        // refinement it has no opinion on.
        let response = generate("[]");
        assert!(!response.quads.is_empty());
        assert!(response.refinement_complete);
    }

    #[test]
    fn z_survives_the_round_trip_as_z() {
        // The one translation this module owns. A silent x/z swap here would
        // show up as terrain generated at ninety degrees to the road, which
        // is a confusing way to find out.
        let response = generate("[]");
        assert!(
            response.vertices.iter().all(|vertex| {
                vertex.x >= -1e-9 && vertex.x <= 10.0 + 1e-9 && vertex.z >= -1e-9 && vertex.z <= 10.0 + 1e-9
            }),
            "a corner left the field it was asked to fill"
        );
        // The four named corners come back at the corners they went in at.
        for (source, x, z) in [(0, 0.0, 0.0), (1, 10.0, 0.0), (2, 10.0, 10.0), (3, 0.0, 10.0)] {
            let found = response
                .vertices
                .iter()
                .find(|vertex| vertex.source == Some(source))
                .unwrap_or_else(|| panic!("source {source} vanished"));
            assert!((found.x - x).abs() < 1e-9 && (found.z - z).abs() < 1e-9);
        }
    }

    #[test]
    fn a_hole_in_the_wire_becomes_a_hole_in_the_ground() {
        let response = generate(
            r#"[[
              {"x": 3, "z": 4, "source": 100},
              {"x": 7, "z": 4, "source": 101},
              {"x": 7, "z": 6, "source": 102},
              {"x": 3, "z": 6, "source": 103}
            ]]"#,
        );

        for quad in &response.quads {
            let x = quad.iter().map(|&i| response.vertices[i].x).sum::<f64>() / 4.0;
            let z = quad.iter().map(|&i| response.vertices[i].z).sum::<f64>() / 4.0;
            assert!(
                !(x > 3.0 && x < 7.0 && z > 4.0 && z < 6.0),
                "a cell centred at ({x}, {z}) sits on the road"
            );
        }
        assert!(
            !response.on_contour.is_empty(),
            "the nodes the road has to adopt are reported"
        );
        assert!(
            response.on_contour.iter().all(|&index| response.vertices[index].source.is_none()),
            "a reported node is one nobody already owned"
        );
    }

    #[test]
    fn the_cell_scale_follows_triangle_side() {
        let coarse: IrregularQuadGridRequest =
            serde_json::from_str(&request_json("[]").replace("\"triangleSide\": 0.5", "\"triangleSide\": 1.5"))
                .expect("parses");
        let fine: IrregularQuadGridRequest =
            serde_json::from_str(&request_json("[]")).expect("parses");

        let coarse = irregular_quad_grid(coarse).expect("a grid");
        let fine = irregular_quad_grid(fine).expect("a grid");
        assert!(
            fine.quads.len() > coarse.quads.len() * 4,
            "a third of the side length should give far more cells; got {} against {}",
            fine.quads.len(),
            coarse.quads.len()
        );
    }

    #[test]
    fn bad_input_is_refused_at_the_boundary_rather_than_panicking() {
        // Panics are not catchable on wasm32, so every one of these has to
        // come back as an error string.
        for (name, json) in [
            ("no boundary", r#"{"seed":1,"triangleSide":0.5,"boundary":[]}"#),
            ("a boundary of two points", r#"{"seed":1,"triangleSide":0.5,"boundary":[[{"x":0,"z":0},{"x":1,"z":1}]]}"#),
            ("a zero side", r#"{"seed":1,"triangleSide":0,"boundary":[[{"x":0,"z":0},{"x":1,"z":0},{"x":0,"z":1}]]}"#),
            ("a negative side", r#"{"seed":1,"triangleSide":-1,"boundary":[[{"x":0,"z":0},{"x":1,"z":0},{"x":0,"z":1}]]}"#),
        ] {
            let request: IrregularQuadGridRequest =
                serde_json::from_str(json).unwrap_or_else(|error| panic!("{name}: {error}"));
            assert!(irregular_quad_grid(request).is_err(), "{name} should be refused");
        }
    }
}
