//! Step 1 (constrained) -- triangles that stop at contours somebody else owns.
//!
//! The unconstrained stage ([`crate::hex`]) lays an equilateral lattice and
//! knows nothing about what is already standing. That is right for a stroke
//! on empty ground and wrong for everything else: ground meeting a road has
//! to meet it *exactly*, on the road's own nodes, along the road's own edges.
//!
//! A constrained Delaunay triangulation is that guarantee, rather than an
//! approximation of it. Contour edges are declared as constraints, and no
//! triangle may cross one -- so "the terrain stops at the road" is a property
//! of the triangulation, not something checked afterwards and patched where
//! it failed.
//!
//! **Why the caller's node ids come back out.** Every generated fill this
//! replaces failed the same way: a geometry library answered in *positions*,
//! and the code then had to work out which existing node each position was,
//! by proximity. That guess is what minted a second node on top of a real one
//! and left seams that looked joined and were not. Here a constraint vertex
//! carries its [`ConstraintPoint::source`] through the triangulation and comes
//! back still carrying it. There is no matching step, so there is nothing to
//! get wrong. A vertex that comes back with `None` is genuinely new ground --
//! interior the refinement invented, or a junction where two contours cross --
//! and the caller mints a node for it knowing exactly that.
//!
//! **Refinement may split a contour.** Ruppert's algorithm inserts points on a
//! constraint segment when a nearby vertex encroaches on it. That is wanted,
//! not tolerated: the alternative is a terrain vertex sitting against the
//! middle of a road edge without sharing it, which is a T-junction -- the
//! precise shape of the "gap along the path" this whole approach exists to
//! remove. The cloud that owns the contour has to accept nodes appearing
//! along its boundary; in exchange nothing is ever merely near anything.

use std::collections::HashMap;

use spade::{
    AngleLimit, ConstrainedDelaunayTriangulation, HasPosition, Point2, RefinementParameters,
    Triangulation,
};

use crate::geometry::{centroid_of, distance_to_segment, signed_area};
use crate::mesh::{FaceMesh, Vec2};

/// One point of a contour handed over as a constraint.
#[derive(Debug, Clone, Copy)]
pub struct ConstraintPoint {
    pub position: Vec2,
    /// The caller's own identity for this point, carried through untouched.
    ///
    /// An index into whatever table the caller keeps, never a node id itself:
    /// this crate stays free of any particular graph's identifier type, the
    /// same way it stays free of elevation.
    pub source: Option<u32>,
}

/// What bounds the ground being generated.
#[derive(Debug, Clone)]
pub struct ConstrainedOptions {
    /// Closed rings bounding the ground being generated, each implicitly
    /// closed from its last point back to its first.
    pub boundary: Vec<Vec<ConstraintPoint>>,
    /// Closed rings of ground somebody else already holds -- a road contour,
    /// a building footprint -- subtracted from [`Self::boundary`].
    ///
    /// Kept separate from the boundary rather than folded in as more rings of
    /// one list, and the distinction is not cosmetic. Odd winding over one
    /// combined list gets a hole *inside* the ground right and a hole that
    /// crosses clean through it wrong: the part of a road that overshoots the
    /// ground it cuts winds once, reads as odd, and would come back as ground
    /// that was never there. Ground is `boundary AND NOT holes`, which is
    /// what these two fields say and one list cannot.
    ///
    /// Every ring is a constraint either way -- no triangle crosses one,
    /// whichever list it came from. This only decides which of the resulting
    /// faces are handed back.
    pub holes: Vec<Vec<ConstraintPoint>>,
    /// Interior points to seed the triangulation with, before refinement.
    ///
    /// This is what keeps the result looking like the rest of the world. The
    /// refinement on its own produces a *quality* mesh, not this particular
    /// one; seeding it with the same equilateral lattice the unconstrained
    /// stage uses means the interior comes out with the lattice spacing, and
    /// only the band near a contour adapts.
    pub seeds: Vec<Vec2>,
    /// How close to a constraint a seed may fall before it is dropped.
    ///
    /// A lattice point landing all but on a contour makes a sliver the
    /// refinement then has to work to remove. Cheaper to not create it.
    pub seed_clearance: f64,
    /// Largest triangle the refinement will leave standing. The cell scale.
    pub max_area: f64,
    /// Smallest triangle the refinement will bother to improve. `0` disables
    /// the floor.
    ///
    /// This is the guard against the one input that actually costs: two
    /// contours running close and near-parallel. The local feature size
    /// between them collapses, and without a floor the refinement fills the
    /// wedge with slivers -- measured at three times the whole area's worth
    /// of cells for a gap of a fortieth of one. With a floor at 15% of
    /// [`Self::max_area`] that case loses two thirds of its cells and half
    /// its time, while every input *without* such a wedge comes back cell for
    /// cell identical. It buys the pathological case and costs the ordinary
    /// one nothing, which is why it is on by default at the bridge.
    ///
    /// A sharp *angle* alone is not the problem it is often assumed to be:
    /// measured, a three degree wedge costs about five percent.
    pub min_area: f64,
    /// Smallest angle the refinement will leave standing, in degrees.
    ///
    /// Ruppert is only proven to terminate below roughly 20.7 degrees; above
    /// that it may keep splitting until it runs out of its vertex budget. 30
    /// is the value it is normally used at in practice, with the budget as
    /// the guard rail behind it.
    pub min_angle_degrees: f64,
    /// Hard ceiling on points the refinement may invent, so a pathological
    /// contour costs a worse mesh rather than an unbounded loop.
    pub max_additional_vertices: usize,
}

/// The triangles, and where each of their corners came from.
#[derive(Debug, Clone)]
pub struct ConstrainedTriangles {
    /// Triangles only, wound counter-clockwise, ready for the shared tail of
    /// the pipeline ([`crate::build_from_triangles`]).
    pub mesh: FaceMesh,
    /// Index-aligned with `mesh.vertices`: the [`ConstraintPoint::source`]
    /// that vertex arrived with, or `None` where the triangulation made it.
    pub sources: Vec<Option<u32>>,
    /// `false` where the refinement hit `max_additional_vertices` and stopped
    /// early. The mesh is still usable -- just coarser somewhere.
    pub refinement_complete: bool,
}

/// A triangulation vertex: a position, plus whatever the caller called it.
#[derive(Debug, Clone, Copy)]
struct GridVertex {
    position: Point2<f64>,
    source: Option<u32>,
}

impl HasPosition for GridVertex {
    type Scalar = f64;
    fn position(&self) -> Point2<f64> {
        self.position
    }
}

/// How the refinement mints the points it invents.
///
/// `source: None` is the whole content of this impl, and it is the contract
/// the caller reads back out: a vertex the refinement created belongs to
/// nobody, so nothing downstream can mistake it for a node that already
/// existed. Ruppert only ever adds vertices, never repositions the ones it
/// was given, so a vertex that arrived with a source keeps it.
impl From<Point2<f64>> for GridVertex {
    fn from(position: Point2<f64>) -> Self {
        Self { position, source: None }
    }
}

/// Triangulates the ground `options.boundary` encloses and `options.holes`
/// take back, refined to the cell scale.
///
/// Returns `None` only when the constraints cannot form a triangulation at
/// all -- fewer than three distinct points, or coordinates the exact
/// predicates refuse (infinite, NaN, or beyond the representable range). A
/// caller that gets `None` has ground it cannot describe, and should leave
/// what is standing alone rather than substitute something.
pub fn triangulate_constrained(options: &ConstrainedOptions) -> Option<ConstrainedTriangles> {
    let mut cdt: ConstrainedDelaunayTriangulation<GridVertex> =
        ConstrainedDelaunayTriangulation::new();

    let mut segments: Vec<(Vec2, Vec2)> = Vec::new();
    for ring in options.boundary.iter().chain(options.holes.iter()) {
        if ring.len() < 3 {
            continue;
        }
        let mut handles = Vec::with_capacity(ring.len());
        for point in ring {
            let vertex = GridVertex {
                position: Point2::new(point.position.x, point.position.y),
                source: point.source,
            };
            handles.push(cdt.insert(vertex).ok()?);
        }
        for (position, &from) in handles.iter().enumerate() {
            let to = handles[(position + 1) % handles.len()];
            if from == to {
                continue;
            }
            // `_and_split`, because two contours may genuinely cross -- one
            // road over another. The crossing becomes a real vertex both
            // constraints then run through, which is what a junction is. An
            // unsplit `add_constraint` would refuse the second one instead.
            cdt.add_constraint_and_split(from, to, |position| GridVertex { position, source: None });
        }
        for (position, point) in ring.iter().enumerate() {
            segments.push((point.position, ring[(position + 1) % ring.len()].position));
        }
    }

    if cdt.num_vertices() < 3 {
        return None;
    }

    let ground = Ground::of(options);
    for &seed in &options.seeds {
        if !ground.covers(seed) {
            continue;
        }
        if segments
            .iter()
            .any(|&(from, to)| distance_to_segment(seed, from, to) < options.seed_clearance)
        {
            continue;
        }
        cdt.insert(GridVertex { position: Point2::new(seed.x, seed.y), source: None }).ok()?;
    }

    let mut parameters = RefinementParameters::<f64>::new()
        .with_angle_limit(AngleLimit::from_deg(options.min_angle_degrees))
        .with_max_allowed_area(options.max_area);
    if options.min_area > 0.0 {
        parameters = parameters.with_min_required_area(options.min_area);
    }
    let outcome = cdt.refine(
        parameters
            .with_max_additional_vertices(options.max_additional_vertices)
            .exclude_outer_faces(true),
    );

    // Only the vertices the kept faces actually use, compacted -- the
    // triangulation holds every seed that was dropped as an outer face
    // corner too, and handing those on would put nodes in the graph that
    // bound nothing.
    let mut remap: HashMap<usize, usize> = HashMap::new();
    let mut vertices: Vec<Vec2> = Vec::new();
    let mut sources: Vec<Option<u32>> = Vec::new();
    let mut faces: Vec<Vec<usize>> = Vec::new();

    for face in cdt.inner_faces() {
        // Classified here rather than taken from `outcome.excluded_faces`,
        // because the two rules differ exactly where it matters (see
        // `ConstrainedOptions::holes`). Spade own exclusion stays switched on
        // regardless: it only ever excludes faces this rule also rejects, so
        // it costs nothing and saves the refinement from working on ground
        // nobody asked for.
        let corner_positions =
            face.positions().map(|point| Vec2::new(point.x, point.y));
        if !ground.covers(centroid_of(&corner_positions)) {
            continue;
        }
        let corners = face.vertices().map(|vertex| {
            let index = vertex.index();
            match remap.get(&index) {
                Some(&resolved) => resolved,
                None => {
                    let data = vertex.data();
                    vertices.push(Vec2::new(data.position.x, data.position.y));
                    sources.push(data.source);
                    remap.insert(index, vertices.len() - 1);
                    vertices.len() - 1
                }
            }
        });
        let [a, b, c] = corners;
        if a == b || b == c || a == c {
            continue;
        }
        // Wound counter-clockwise explicitly rather than by trusting the
        // library convention: everything downstream -- the rhombus merge
        // especially -- assumes one consistent winding, and a silently
        // reversed cell only surfaces much later as a backwards face.
        if signed_area(vertices[a], vertices[b], vertices[c]) < 0.0 {
            faces.push(vec![a, c, b]);
        } else {
            faces.push(vec![a, b, c]);
        }
    }

    if faces.is_empty() {
        return None;
    }

    Some(ConstrainedTriangles {
        mesh: FaceMesh { vertices, faces },
        sources,
        refinement_complete: outcome.refinement_complete,
    })
}

/// Where on a supplied contour a point sits.
///
/// Not a boolean, because the caller needs to *act* on it. A node the grid
/// puts along a neighbour edge has to be adopted by that neighbour, and
/// adopting it means splitting the exact edge it landed on. Answering "yes,
/// somewhere" would send the caller back to finding that edge by position,
/// which is the proximity guess this whole design exists to remove: the
/// segment is named here, and the caller supplied the rings, so it already
/// knows which of its own edges that is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContourLocation {
    /// `false` for a ring of `boundary`, `true` for one of `holes`.
    pub in_holes: bool,
    /// Index of the ring within whichever of the two lists.
    pub ring: usize,
    /// Index of the segment within that ring, by the point it starts at.
    pub segment: usize,
}

/// Which contour segment `point` sits on, if any.
///
/// The nearest one wins where several are within `tolerance`, which happens
/// at a ring corner -- both segments meeting there contain the point, and
/// either is a correct answer since the corner is a node both already share.
pub fn locate_on_contour(
    options: &ConstrainedOptions,
    point: Vec2,
    tolerance: f64,
) -> Option<ContourLocation> {
    let mut best: Option<(f64, ContourLocation)> = None;
    for (in_holes, rings) in [(false, &options.boundary), (true, &options.holes)] {
        for (ring_index, ring) in rings.iter().enumerate() {
            if ring.len() < 3 {
                continue;
            }
            for segment in 0..ring.len() {
                let from = ring[segment].position;
                let to = ring[(segment + 1) % ring.len()].position;
                let distance = distance_to_segment(point, from, to);
                if distance > tolerance {
                    continue;
                }
                let location = ContourLocation { in_holes, ring: ring_index, segment };
                if best.is_none_or(|(closest, _)| distance < closest) {
                    best = Some((distance, location));
                }
            }
        }
    }
    best.map(|(_, location)| location)
}

/// Ground is what the boundary encloses and no hole takes back, with every
/// ring's orientation settled first.
///
/// Built once per triangulation and then asked per seed and per face, so the
/// two can never disagree about where the ground is.
struct Ground<'a> {
    boundary: &'a [Vec<ConstraintPoint>],
    holes: &'a [Vec<ConstraintPoint>],
    boundary_signs: Vec<i32>,
    hole_signs: Vec<i32>,
}

impl<'a> Ground<'a> {
    fn of(options: &'a ConstrainedOptions) -> Self {
        Self {
            boundary: &options.boundary,
            holes: &options.holes,
            boundary_signs: orientation_signs(&options.boundary),
            hole_signs: orientation_signs(&options.holes),
        }
    }

    fn covers(&self, point: Vec2) -> bool {
        inside_rings(self.boundary, &self.boundary_signs, point)
            && !inside_rings(self.holes, &self.hole_signs, point)
    }
}

/// Which way each ring has to be walked for the winding rule to mean what the
/// caller intended.
///
/// **The winding rule needs consistently oriented rings, and this is what
/// makes them consistent instead of assuming they already are.** The rings
/// arrive from two sources with two different conventions -- the brush's swept
/// outline comes from `polygon-clipping`, the standing ground's rims come from
/// walking the graph -- and nothing ever reconciled them. Two hole rings that
/// happened to be wound against each other summed to zero, the point read as
/// free ground, and the generator planned faces on top of ground that was
/// still standing. The engine then refused each of those faces, one at a time,
/// with "no room on edge -- its one free side faces the other way". On the
/// table that is a stroke that lands full of holes wherever it meets what is
/// already there, worst at a crossing, where the most rims meet.
///
/// A ring is walked positive when it sits at even nesting depth and negative
/// at odd, which is exactly the outer-rim/inner-rim alternation the rule
/// wants. Nesting is "every vertex of this ring lies inside that one", not
/// "its middle does": two contours that merely cross -- two roads -- each have
/// vertices outside the other, stay at depth zero, and so still add rather
/// than cancel.
fn orientation_signs(rings: &[Vec<ConstraintPoint>]) -> Vec<i32> {
    rings
        .iter()
        .enumerate()
        .map(|(index, ring)| {
            let depth = rings
                .iter()
                .enumerate()
                .filter(|&(other, _)| other != index)
                .filter(|&(_, outer)| nests_inside(ring, outer))
                .count();
            let wanted = if depth % 2 == 0 { 1.0 } else { -1.0 };
            if twice_signed_area(ring) * wanted >= 0.0 { 1 } else { -1 }
        })
        .collect()
}

/// Whether `inner` sits wholly within `outer`.
///
/// Every vertex, deliberately. A centroid test calls two crossing roads nested
/// -- the middle of each does fall inside the other -- and flipping one of
/// them is precisely the cancellation this is here to prevent.
fn nests_inside(inner: &[ConstraintPoint], outer: &[ConstraintPoint]) -> bool {
    inner.iter().all(|point| winding_of(outer, point.position) != 0)
}

/// Twice the signed area of a whole ring, by the shoelace rule: positive
/// counter-clockwise. Named apart from `geometry::signed_area`, which is the
/// area of one triangle.
fn twice_signed_area(ring: &[ConstraintPoint]) -> f64 {
    let mut twice = 0.0;
    for index in 0..ring.len() {
        let from = ring[index].position;
        let to = ring[(index + 1) % ring.len()].position;
        twice += from.x * to.y - to.x * from.y;
    }
    twice
}

/// Containment against a *set* of rings, by the nonzero winding rule, each
/// ring counted in the direction {@link orientation_signs} settled on.
///
/// Neither of the two obvious rules is right here, and each fails a case the
/// table actually draws.
///
/// One even-odd sweep over every ring at once fails where two contours
/// genuinely overlap -- two roads crossing. That crossing winds twice, reads
/// as even, and comes back out as ground: terrain generated in the middle of
/// a crossroads, standing on both roads at once.
///
/// A union of per-ring tests fails the opposite way, on any shape with a hole
/// in it. A patch of terrain with a gap in the middle has an outer perimeter
/// and an inner one, and the union says the gap is occupied, so nothing is
/// ever laid there.
///
/// Winding handles both -- once the rings are oriented, which is the whole
/// reason `orientation_signs` exists.
fn inside_rings(rings: &[Vec<ConstraintPoint>], signs: &[i32], point: Vec2) -> bool {
    let mut winding = 0i32;
    for (index, ring) in rings.iter().enumerate() {
        winding += signs.get(index).copied().unwrap_or(1) * winding_of(ring, point);
    }
    winding != 0
}

/// {@link winding_number} over a ring still in its constraint form.
fn winding_of(ring: &[ConstraintPoint], point: Vec2) -> i32 {
    let positions: Vec<Vec2> = ring.iter().map(|entry| entry.position).collect();
    winding_number(&positions, point)
}

/// How many times `ring` wraps around `point`, signed by its direction.
fn winding_number(ring: &[Vec2], point: Vec2) -> i32 {
    let mut winding = 0i32;
    for index in 0..ring.len() {
        let from = ring[index];
        let to = ring[(index + 1) % ring.len()];
        // Which side of the directed edge the point falls on; positive is to
        // its left.
        let side = (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y);
        if from.y <= point.y {
            if to.y > point.y && side > 0.0 {
                winding += 1;
            }
        } else if to.y <= point.y && side < 0.0 {
            winding -= 1;
        }
    }
    winding
}


