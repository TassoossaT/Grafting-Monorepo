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

use crate::geometry::{centroid_of, distance_to_segment, inside_ring, signed_area};
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

    for &seed in &options.seeds {
        if !is_ground(options, seed) {
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

    let outcome = cdt.refine(
        RefinementParameters::<f64>::new()
            .with_angle_limit(AngleLimit::from_deg(options.min_angle_degrees))
            .with_max_allowed_area(options.max_area)
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
        if !is_ground(options, centroid_of(&corner_positions)) {
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

/// Ground is what the boundary encloses and no hole takes back.
///
/// The one rule, applied to seeds before the triangulation and to faces
/// after it, so the two can never disagree about where the ground is.
fn is_ground(options: &ConstrainedOptions, point: Vec2) -> bool {
    inside_rings(&options.boundary, point) && !inside_rings(&options.holes, point)
}

/// Containment against a *set* of rings: inside any one of them counts.
///
/// The union, deliberately, rather than one even-odd sweep over all of them
/// at once. Each ring here is an independent contour some cloud owns, not a
/// ring of one polygon, and two of them genuinely overlap where two roads
/// cross. Under one combined sweep that crossing winds twice, reads as even,
/// and comes back out as ground -- terrain generated in the middle of a
/// crossroads, standing on both roads at once. Each ring is tested even-odd
/// on its own, which is what makes a ring that describes a shape with a
/// pinch or a figure-eight still behave.
fn inside_rings(rings: &[Vec<ConstraintPoint>], point: Vec2) -> bool {
    rings.iter().any(|ring| {
        let positions: Vec<Vec2> = ring.iter().map(|entry| entry.position).collect();
        inside_ring(&positions, point)
    })
}


