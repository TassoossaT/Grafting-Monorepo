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
//! **A contour gains a node only where it converges.** Any corner the grid
//! puts along a contour has to be shared by the cloud owning it -- the
//! alternative is a terrain vertex sitting against the middle of a road edge
//! without sharing it, which is a T-junction, the precise shape of the "gap
//! along the path" this whole approach exists to remove. But a node the owner
//! adopts is a node the next fill beside it reads back as contour, and a grid
//! that put a midpoint on every contour segment it met halved that contour on
//! each regeneration. [`triangulate_keeping_seams`] hands short runs of a
//! contour over as one segment each and never lets the refinement split them,
//! so the nodes already standing come back as the corners the grid needed;
//! only a segment longer than [`SHORTEST_SPLIT`] is cut, once.

use std::collections::{HashMap, HashSet};

use spade::handles::FixedVertexHandle;
use spade::{
    AngleLimit, ConstrainedDelaunayTriangulation, HasPosition, Point2, RefinementParameters,
    Triangulation,
};

use crate::geometry::{centroid_of, distance_to_segment, inside_ring, signed_area};
use crate::mesh::{FaceMesh, Vec2, edge_key};

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
    triangulate(options, false).map(|(triangles, _)| triangles)
}

/// A stretch of a supplied contour the triangulation saw as a single edge.
#[derive(Debug, Clone)]
pub struct Seam {
    /// The edge's corners, as indices into the triangles' own vertices, in the
    /// order the ring walks them.
    pub from: usize,
    pub to: usize,
    /// The contour points strictly between them, in the same order, that the
    /// triangulation never saw. Empty for a segment too short to be worth a
    /// node of its own (see [`SHORTEST_SPLIT`]).
    pub held: Vec<ConstraintPoint>,
}

/// How long a stretch of contour may be handed over as one segment, as a
/// fraction of the lattice triangle side.
///
/// Ortho halves every edge it quadrangulates, so the contour a finished grid
/// leaves behind is walked at half the length of the segments it was
/// triangulated against. Reading that contour back as-is is what doubled a
/// seam's nodes on every regeneration. Two of its segments together are one
/// segment of the length the grid was built from, so that is what the
/// triangulation is given; three quarters of a triangle side takes in two
/// face-length segments with room to spare and stops short of ever joining
/// three.
const LONGEST_SEAM: f64 = 0.75;

/// How far a held-out point may stand off the chord replacing it, as a fraction
/// of the lattice triangle side. A real corner of the contour is further off
/// than this and stays a corner the triangulation sees.
const SEAM_STRAYING: f64 = 0.1;

/// The longest contour segment handed to the triangulation undivided, as a
/// fraction of the lattice triangle side.
///
/// A seam's edge is never split by the refinement, so a long segment has to be
/// divided before it goes in or the cells along it come out as long as it is.
/// It is cut into an even number of equal pieces no longer than this: new
/// nodes the contour's owner adopts once, which the next regeneration reads
/// back in pairs and hands over as seams. That is the one place new nodes
/// still reach a contour, and it converges -- nothing it produces is long
/// enough to be cut again. A piece no pair takes in gets no node of its own:
/// the cells at its two corners merge into one polygon instead.
const SHORTEST_SPLIT: f64 = 0.375;

/// `ring` with every segment longer than `longest` cut into an even number of
/// equal pieces no longer than it. The new points name no node.
fn subdivided(ring: &[ConstraintPoint], longest: f64) -> Vec<ConstraintPoint> {
    if ring.len() < 3 {
        return ring.to_vec();
    }
    let mut points = Vec::with_capacity(ring.len());
    for (index, point) in ring.iter().enumerate() {
        points.push(*point);
        let from = point.position;
        let to = ring[(index + 1) % ring.len()].position;
        let length = (to.x - from.x).hypot(to.y - from.y);
        if !(length > longest) {
            continue;
        }
        let mut pieces = (length / longest).ceil() as usize;
        pieces += pieces % 2;
        for piece in 1..pieces {
            let along = piece as f64 / pieces as f64;
            points.push(ConstraintPoint {
                position: Vec2::new(from.x + (to.x - from.x) * along, from.y + (to.y - from.y) * along),
                source: None,
            });
        }
    }
    points
}

/// [`triangulate_constrained`], with every supplied contour's short, nearly
/// straight runs handed over as one segment and returned as [`Seam`]s.
///
/// This is the half of keeping a contour's node count stable that happens
/// before quadrangulation; [`crate::ortho::ortho_along`] is the other. Every
/// point is kept in the finished grid either way -- what changes is only that
/// the triangulation is built at the scale the contour was originally laid at.
///
/// Refinement never splits a seam here, for the same reason a midpoint never
/// lands on one: that point would be a node the contour's owner has to adopt.
/// `None` where the contours describe no ground, and also where a seam did not
/// survive as one edge -- two contours crossing through it -- in which case
/// the caller has to triangulate without seams.
pub fn triangulate_keeping_seams(options: &ConstrainedOptions) -> Option<(ConstrainedTriangles, Vec<Seam>)> {
    triangulate(options, true)
}

/// The side of the lattice triangle whose area is `area`.
fn lattice_side_of(area: f64) -> f64 {
    (area * 4.0 / 3f64.sqrt()).sqrt()
}

/// Which points of `ring` the triangulation sees, in ring order.
///
/// A point is held out when it lies near the middle of the chord joining its
/// two neighbours, and those neighbours are both kept. Holding out every such
/// point greedily from one that cannot be held is the largest set possible
/// along a closed walk, so the triangulation's segments come out as long as
/// the rules allow.
fn kept_points(ring: &[ConstraintPoint], longest: f64, straying: f64) -> Vec<usize> {
    let count = ring.len();
    let all = || (0..count).collect::<Vec<usize>>();
    if count < 4 {
        return all();
    }
    let holdable = |index: usize| {
        let before = ring[(index + count - 1) % count].position;
        let point = ring[index].position;
        let after = ring[(index + 1) % count].position;
        let dx = after.x - before.x;
        let dy = after.y - before.y;
        let chord_squared = dx * dx + dy * dy;
        if chord_squared <= f64::EPSILON || chord_squared > longest * longest {
            return false;
        }
        let along = ((point.x - before.x) * dx + (point.y - before.y) * dy) / chord_squared;
        (0.2..=0.8).contains(&along) && distance_to_segment(point, before, after) <= straying
    };
    let start = (0..count).find(|&index| !holdable(index)).unwrap_or(0);
    let mut held = vec![false; count];
    for step in 1..count {
        let index = (start + step) % count;
        held[index] = !held[(index + count - 1) % count] && holdable(index);
    }
    let kept: Vec<usize> = (0..count).filter(|&index| !held[index]).collect();
    if kept.len() < 3 { all() } else { kept }
}

fn triangulate(options: &ConstrainedOptions, keep_seams: bool) -> Option<(ConstrainedTriangles, Vec<Seam>)> {
    let side = lattice_side_of(options.max_area);
    let rings: Vec<Vec<ConstraintPoint>> = options
        .boundary
        .iter()
        .chain(options.holes.iter())
        .map(|ring| if keep_seams { subdivided(ring, side * SHORTEST_SPLIT) } else { ring.clone() })
        .collect();
    let kept: Vec<Vec<usize>> = rings
        .iter()
        .map(|ring| {
            if keep_seams {
                kept_points(ring, side * LONGEST_SEAM, side * SEAM_STRAYING)
            } else {
                (0..ring.len()).collect()
            }
        })
        .collect();
    // Ground is classified against the rings as triangulated, since those are
    // the edges the triangles actually stop at.
    let coarse = |range: std::ops::Range<usize>| -> Vec<Vec<ConstraintPoint>> {
        range.map(|index| kept[index].iter().map(|&point| rings[index][point]).collect()).collect()
    };
    let boundary_winding = RingWinding::of(&coarse(0..options.boundary.len()));
    let hole_winding = RingWinding::of(&coarse(options.boundary.len()..rings.len()));
    let mut cdt: ConstrainedDelaunayTriangulation<GridVertex> =
        ConstrainedDelaunayTriangulation::new();

    let mut pending: Vec<(FixedVertexHandle, FixedVertexHandle, Vec<ConstraintPoint>)> = Vec::new();
    let mut segments: Vec<(Vec2, Vec2)> = Vec::new();
    for (ring, kept) in rings.iter().zip(&kept) {
        if kept.len() < 3 {
            continue;
        }
        let mut handles = Vec::with_capacity(kept.len());
        for &index in kept {
            let point = ring[index];
            let vertex = GridVertex {
                position: Point2::new(point.position.x, point.position.y),
                source: point.source,
            };
            handles.push(cdt.insert(vertex).ok()?);
        }
        for (position, &from) in handles.iter().enumerate() {
            let next = (position + 1) % handles.len();
            let to = handles[next];
            let held: Vec<ConstraintPoint> = if keep_seams {
                (1..ring.len())
                    .map(|step| (kept[position] + step) % ring.len())
                    .take_while(|&index| index != kept[next])
                    .map(|index| ring[index])
                    .collect()
            } else {
                Vec::new()
            };
            if from == to {
                // Two kept points at one position with nodes between them:
                // there is no edge to carry those nodes on.
                if !held.is_empty() {
                    return None;
                }
                continue;
            }
            // `_and_split`, because two contours may genuinely cross -- one
            // road over another. The crossing becomes a real vertex both
            // constraints then run through, which is what a junction is. An
            // unsplit `add_constraint` would refuse the second one instead.
            cdt.add_constraint_and_split(from, to, |position| GridVertex { position, source: None });
            if keep_seams {
                pending.push((from, to, held));
            }
        }
        for (position, &index) in kept.iter().enumerate() {
            segments.push((ring[index].position, ring[kept[(position + 1) % kept.len()]].position));
        }
    }

    if cdt.num_vertices() < 3 {
        return None;
    }

    for &seed in &options.seeds {
        if !is_ground(&boundary_winding, &hole_winding, seed) {
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
    if keep_seams {
        parameters = parameters.keep_constraint_edges();
    }
    let outcome = cdt.refine(
        parameters
            .with_max_additional_vertices(options.max_additional_vertices)
            .exclude_outer_faces(true),
    );

    // A seam another contour crossed was split into pieces, and the nodes it
    // held have no single edge left to go back onto. So does one the same
    // stretch of two rings claims twice.
    let mut claimed: HashSet<(usize, usize)> = HashSet::new();
    for (from, to, _) in &pending {
        cdt.get_edge_from_neighbors(*from, *to)?;
        if !claimed.insert(edge_key(from.index(), to.index())) {
            return None;
        }
    }

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
        if !is_ground(&boundary_winding, &hole_winding, centroid_of(&corner_positions)) {
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

    // A seam with a corner no ground face uses borders no ground, and the
    // nodes it held have nothing to be put back into.
    let seams = pending
        .into_iter()
        .filter_map(|(from, to, held)| {
            Some(Seam { from: *remap.get(&from.index())?, to: *remap.get(&to.index())?, held })
        })
        .collect();

    Some((
        ConstrainedTriangles {
            mesh: FaceMesh { vertices, faces },
            sources,
            refinement_complete: outcome.refinement_complete,
        },
        seams,
    ))
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
fn is_ground(boundary_winding: &RingWinding, hole_winding: &RingWinding, point: Vec2) -> bool {
    boundary_winding.contains(point) && !hole_winding.contains(point)
}

/// The multiplier that gives every independent outer ring the same winding,
/// while preserving the relative winding of rings nested inside it.
///
/// A set of occupied contours is a union. Two independently-created terrain
/// patches may arrive with opposite orientations; where they cross, summing
/// their raw winding cancels to zero and incorrectly classifies the overlap as
/// empty ground. Nested rings are different: their relative orientation is
/// meaningful because an inner ring may remove a real hole. We therefore
/// canonicalise each containment tree as a unit, without reversing the input
/// arrays (their segment indexes are part of the caller contract).
struct RingWinding {
    positions: Vec<Vec<Vec2>>,
    multipliers: Vec<i32>,
}

impl RingWinding {
    fn of(rings: &[Vec<ConstraintPoint>]) -> Self {
        let positions: Vec<Vec<Vec2>> = rings
            .iter()
            .map(|ring| ring.iter().map(|point| point.position).collect())
            .collect();
        let areas: Vec<f64> = positions.iter().map(|ring| ring_area(ring)).collect();
        let mut parents = vec![None; rings.len()];

        for child in 0..rings.len() {
            let child_area = areas[child].abs();
            let mut smallest_parent: Option<(usize, f64)> = None;
            for candidate in 0..rings.len() {
                let candidate_area = areas[candidate].abs();
                if candidate == child || candidate_area <= child_area {
                    continue;
                }
                if !positions[child].iter().all(|&point| inside_ring(&positions[candidate], point)) {
                    continue;
                }
                if smallest_parent.is_none_or(|(_, area)| candidate_area < area) {
                    smallest_parent = Some((candidate, candidate_area));
                }
            }
            parents[child] = smallest_parent.map(|(index, _)| index);
        }

        let multipliers = (0..rings.len())
            .map(|mut ring| {
                while let Some(parent) = parents[ring] {
                    ring = parent;
                }
                if areas[ring] < 0.0 { -1 } else { 1 }
            })
            .collect();
        Self { positions, multipliers }
    }

    fn contains(&self, point: Vec2) -> bool {
        self.positions
            .iter()
            .zip(&self.multipliers)
            .map(|(ring, multiplier)| multiplier * winding_number(ring, point))
            .sum::<i32>()
            != 0
    }
}

fn ring_area(ring: &[Vec2]) -> f64 {
    (0..ring.len())
        .map(|index| {
            let from = ring[index];
            let to = ring[(index + 1) % ring.len()];
            from.x * to.y - to.x * from.y
        })
        .sum::<f64>()
        / 2.0
}

/// Why containment uses canonical nonzero winding rather than parity or union.
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
/// ever laid there. Worse, it cannot describe the shape at all, which is what
/// leaves ground planned over faces that are still standing -- and the engine
/// then refuses each of those faces, because the new one and the old one both
/// claim the same side of the edge between them.
///
/// Winding handles both after each independent containment tree is put into a
/// canonical orientation. An outer ring and the inner ring of its own hole
/// keep their opposite directions and subtract; separate outer contours are
/// made equal and add where they overlap.
///
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

