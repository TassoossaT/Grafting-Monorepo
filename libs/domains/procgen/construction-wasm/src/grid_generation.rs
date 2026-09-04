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
#[serde(rename_all = "camelCase", default)]
pub struct RefinementDto {
    pub min_angle_degrees: f64,
    pub max_additional_vertices: usize,
    /// The smallest triangle worth improving, as a fraction of the largest
    /// one allowed. See `ConstrainedOptions::min_area` for what it buys.
    ///
    /// Exposed but not surfaced in any UI, deliberately: its job is to stop a
    /// pathology, not to be an aesthetic dial. Pushed near `1.0` it would
    /// stop the refinement from doing its work at all.
    pub min_area_ratio: f64,
}

impl Default for RefinementDto {
    fn default() -> Self {
        Self { min_angle_degrees: 30.0, max_additional_vertices: 50_000, min_area_ratio: 0.15 }
    }
}

/// `default` on the container, not only on the field that holds one: a caller
/// that wants to move a single knob -- the irregularity slider sends
/// `strength` alone -- should not have to restate the others to do it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
    /// How wide one finished terrain face should be, in world units.
    ///
    /// The face, not the lattice triangle it descends from. Two subdivision
    /// stages sit between the two -- triangles pair into rhombi, and the
    /// Conway ortho step cuts every resulting cell into four -- so a caller
    /// asking in lattice terms gets faces about a third of the size it meant.
    /// This side owns that conversion so nobody has to carry it.
    pub face_side: f64,
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

/// One corner the grid put along a contour the caller supplied.
///
/// `ringKind`/`ring`/`segment` address it back into the request: the segment
/// running from point `segment` of that ring to the next one. The caller
/// already knows which of its own edges that is, so adopting the node is
/// splitting a known edge rather than hunting for one by position.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourNodeDto {
    pub vertex: usize,
    /// `"boundary"` or `"hole"` -- which of the two request lists `ring`
    /// indexes. A hand-written string, never a derived `Debug`, so renaming
    /// anything in Rust cannot silently change the JSON contract.
    pub ring_kind: &'static str,
    pub ring: usize,
    pub segment: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrregularQuadGridResponse {
    pub vertices: Vec<GridVertexDto>,
    pub quads: Vec<[usize; 4]>,
    /// Corners sitting on a supplied contour that had no source -- nodes the
    /// cloud owning that contour has to adopt, each naming its segment.
    pub on_contour: Vec<ContourNodeDto>,
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
/// How much wider the lattice triangle is than the face that descends from it.
///
/// Two stages sit in between. Pairing turns two triangles into one rhombus,
/// and the Conway ortho step cuts every cell into four, so four faces come out
/// of every two triangles: geometrically a face is `sqrt(sqrt(3) / 8)` of a
/// triangle side, about `0.47`. The refinement then adds its own points on top
/// of the seeded lattice, which makes the real result finer again -- measured
/// across four scales it settles at about a third rather than a half, and
/// stays there, which is why this is one measured constant rather than the
/// clean derivation.
///
/// `tests::a_face_comes_back_the_size_it_was_asked_for` is what holds it
/// honest; if the pipeline's stages ever change, that test moves this number.
const FACE_SIDE_TO_LATTICE_SIDE: f64 = 3.0;

pub fn irregular_quad_grid(
    request: IrregularQuadGridRequest,
) -> Result<IrregularQuadGridResponse, String> {
    if !(request.face_side > 0.0) {
        return Err("faceSide must be a positive number".to_string());
    }
    let triangle_side = request.face_side * FACE_SIDE_TO_LATTICE_SIDE;
    let boundary = rings_of(&request.boundary);
    if boundary.iter().all(|ring| ring.len() < 3) {
        return Err("boundary needs at least one ring of three or more points".to_string());
    }
    let holes = rings_of(&request.holes);

    let (min, max) = bounds_of(&boundary).ok_or("boundary holds no usable point")?;

    let options = ConstrainedOptions {
        seeds: lattice_covering(min, max, triangle_side),
        boundary,
        holes,
        seed_clearance: triangle_side * 0.25,
        max_area: lattice_triangle_area(triangle_side),
        min_area: lattice_triangle_area(triangle_side) * request.refinement.min_area_ratio,
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
        on_contour: grid
            .on_contour
            .iter()
            .map(|node| ContourNodeDto {
                vertex: node.vertex,
                ring_kind: if node.location.in_holes { "hole" } else { "boundary" },
                ring: node.location.ring,
                segment: node.location.segment,
            })
            .collect(),
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
              "faceSide": 0.5,
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
            response.on_contour.iter().all(|node| response.vertices[node.vertex].source.is_none()),
            "a reported node is one nobody already owned"
        );
        assert!(
            response.on_contour.iter().any(|node| node.ring_kind == "hole"),
            "the road contour is quadrangulated too, so it gains nodes it must adopt"
        );
        assert!(
            response.on_contour.iter().all(|node| node.ring_kind == "hole" || node.ring_kind == "boundary"),
            "ringKind is one of exactly two strings"
        );
    }

    #[test]
    fn the_cell_scale_follows_face_side() {
        let coarse: IrregularQuadGridRequest =
            serde_json::from_str(&request_json("[]").replace("\"faceSide\": 0.5", "\"faceSide\": 1.5"))
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

    /// What `FACE_SIDE_TO_LATTICE_SIDE` is for, and the only thing holding it
    /// honest. A caller asks in faces; if a stage of the pipeline is ever
    /// added or removed, the faces come back the wrong size and this is what
    /// says so.
    #[test]
    fn a_face_comes_back_the_size_it_was_asked_for() {
        for asked in [0.5, 1.0, 2.0] {
            let request: IrregularQuadGridRequest = serde_json::from_str(
                &request_json("[]").replace("\"faceSide\": 0.5", &format!("\"faceSide\": {asked}")),
            )
            .expect("parses");
            let grid = irregular_quad_grid(request).expect("a grid");
            // The field is 10x10 and fully covered, so the mean face area is
            // the area over the count.
            let mean_side = (100.0 / grid.quads.len() as f64).sqrt();
            assert!(
                (mean_side / asked - 1.0).abs() < 0.25,
                "asked for faces of {asked}, got a mean side of {mean_side} across {} faces",
                grid.quads.len()
            );
        }
    }

    /// The floor exists for one input -- two contours running close and
    /// near-parallel -- and has to cost nothing everywhere else.
    #[test]
    fn the_minimum_area_floor_leaves_an_ordinary_field_alone() {
        let mut request: IrregularQuadGridRequest = serde_json::from_str(&request_json("[]")).expect("parses");
        request.refinement.min_area_ratio = 0.0;
        let without = irregular_quad_grid(request).expect("a grid");
        let with = irregular_quad_grid(serde_json::from_str(&request_json("[]")).expect("parses")).expect("a grid");
        assert_eq!(with.quads.len(), without.quads.len(), "no wedge here, so nothing for the floor to skip");
    }


    /// A square ring walked in `step`-long segments -- the shape a hole cut
    /// out of an existing quad mesh actually arrives in, one segment per face
    /// edge, rather than as four corners.
    fn walked_square(low: f64, high: f64, step: f64) -> Vec<(f64, f64)> {
        let mut points = Vec::new();
        let mut at = low;
        while at < high { points.push((at, low)); at += step; }
        let mut at = low;
        while at < high { points.push((high, at)); at += step; }
        let mut at = high;
        while at > low { points.push((at, high)); at -= step; }
        let mut at = high;
        while at > low { points.push((low, at)); at -= step; }
        points
    }

    fn mean_face_side(boundary: &[(f64, f64)], face_side: f64) -> f64 {
        let body: Vec<String> =
            boundary.iter().map(|&(x, z)| format!(r#"{{"x":{x},"z":{z}}}"#)).collect();
        let request: IrregularQuadGridRequest = serde_json::from_str(&format!(
            r#"{{"seed":7,"faceSide":{face_side},"boundary":[[{}]]}}"#,
            body.join(",")
        ))
        .expect("parses");
        let grid = irregular_quad_grid(request).expect("a grid");
        let (mut min_x, mut min_z, mut max_x, mut max_z) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for &(x, z) in boundary {
            min_x = min_x.min(x); min_z = min_z.min(z);
            max_x = max_x.max(x); max_z = max_z.max(z);
        }
        ((max_x - min_x) * (max_z - min_z) / grid.quads.len() as f64).sqrt()
    }

    /// **A known limitation, pinned so a fix moves it.**
    ///
    /// How fine the result comes back is driven by how many points the
    /// *boundary* has, not by the area it encloses. The same 8x8 region asked
    /// for with four corners comes back at the face size requested; asked for
    /// with its boundary walked in 2.0-unit segments -- which is exactly how a
    /// hole cut out of a standing quad mesh arrives -- comes back at about
    /// half that, three times as many faces, for the same ground.
    ///
    /// Every boundary segment is a constraint the refinement has to satisfy an
    /// angle bound against, and then ortho puts a midpoint on each one. So a
    /// region filled *inside* existing terrain inherits that terrain's edge
    /// spacing instead of the size the caller asked for, and the smaller the
    /// region the larger the share of it that is near the boundary -- which is
    /// why a small hole comes back visibly finer than the ground around it.
    ///
    /// The fix is to decimate the contour before it becomes a constraint and
    /// to restore the skipped nodes when the patch is built, so the generator
    /// sees a coarse boundary while the graph still gets the fine chain.
    ///
    /// Measured, on a 24x24 region asking for faces of 2, by the length of the
    /// segments its boundary is walked in:
    ///
    /// | segment | mean face side |
    /// |---------|----------------|
    /// | 1       | 1.27           |
    /// | 2       | 1.33           |
    /// | 3       | 1.80           |
    /// | 4       | 1.92           |
    /// | 8       | 1.90           |
    ///
    /// So the boundary only has to be coarsened to about twice the face size
    /// to stop driving the interior -- which, for a rim walked at the face
    /// size, is dropping every other point.
    #[test]
    fn a_walked_boundary_makes_a_finer_mesh_than_the_same_region_asked_for_plainly() {
        let plain = mean_face_side(&[(0.0, 0.0), (8.0, 0.0), (8.0, 8.0), (0.0, 8.0)], 2.0);
        let walked = mean_face_side(&walked_square(0.0, 8.0, 2.0), 2.0);
        assert!((plain - 2.0).abs() < 0.2, "four corners give the size asked for; got {plain}");
        assert!(
            walked < plain * 0.7,
            "the same region, walked, comes back much finer: {walked} against {plain}"
        );
    }

    #[test]
    fn bad_input_is_refused_at_the_boundary_rather_than_panicking() {
        // Panics are not catchable on wasm32, so every one of these has to
        // come back as an error string.
        for (name, json) in [
            ("no boundary", r#"{"seed":1,"faceSide":0.5,"boundary":[]}"#),
            ("a boundary of two points", r#"{"seed":1,"faceSide":0.5,"boundary":[[{"x":0,"z":0},{"x":1,"z":1}]]}"#),
            ("a zero side", r#"{"seed":1,"faceSide":0,"boundary":[[{"x":0,"z":0},{"x":1,"z":0},{"x":0,"z":1}]]}"#),
            ("a negative side", r#"{"seed":1,"faceSide":-1,"boundary":[[{"x":0,"z":0},{"x":1,"z":0},{"x":0,"z":1}]]}"#),
        ] {
            let request: IrregularQuadGridRequest =
                serde_json::from_str(json).unwrap_or_else(|error| panic!("{name}: {error}"));
            assert!(irregular_quad_grid(request).is_err(), "{name} should be refused");
        }
    }
}
