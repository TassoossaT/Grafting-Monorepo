# grafting-procgen-irregular-grid

### `pub const grafting_procgen_irregular_grid::WELD_EPSILON: f64`

The epsilon [`ortho::weld`] merges coincident vertices at.

Well below any distance the pipeline itself produces between two vertices
that are meant to be distinct, and well above the float noise between two
that are meant to be one.

### `pub fn grafting_procgen_irregular_grid::boundary_vertices(mesh: &grafting_procgen_irregular_grid::mesh::QuadMesh) -> std::collections::hash::set::HashSet<usize>`

Vertices on an edge belonging to exactly one quad.

### `pub fn grafting_procgen_irregular_grid::build_constrained_quad_grid(options: &grafting_procgen_irregular_grid::constrained::ConstrainedOptions, seed: u32, relax_options: &grafting_procgen_irregular_grid::relax::RelaxOptions) -> core::option::Option<grafting_procgen_irregular_grid::ConstrainedQuadGrid>`

The whole technique against contours somebody else already owns.

The same five steps as [`build_irregular_quad_grid`], differing only in
where step 1 gets its triangles -- which is the point. Ground created on
empty land and ground regenerated around a road that moved are not two
algorithms that must be kept in agreement; they are this one call with a
different set of constraints.

Every corner sitting on a contour is pinned through relaxation, at the
position the triangulation put it. Relaxing them with everything else
would pull the ground off the road it was just made to meet -- by a
little, which is worse than by a lot, because a seam that is nearly right
still renders as a crack and no longer reads as a bug in the fill.

### `pub fn grafting_procgen_irregular_grid::build_from_triangles(triangles: &grafting_procgen_irregular_grid::mesh::FaceMesh, random: &mut grafting_procgen_irregular_grid::random::Random, relax_options: &grafting_procgen_irregular_grid::relax::RelaxOptions) -> grafting_procgen_irregular_grid::mesh::QuadMesh`

Steps 2 to 5 -- the part that is the same however the triangles arrived.

Public because [`constrained`] produces its triangles a different way and
then wants exactly this, and because keeping the shared tail in one place
is what stops the constrained path from quietly becoming a second grid
generator with its own aesthetic.

### `pub fn grafting_procgen_irregular_grid::build_irregular_quad_grid(options: &grafting_procgen_irregular_grid::IrregularQuadGridOptions) -> grafting_procgen_irregular_grid::mesh::QuadMesh`

Runs the five steps in order, unconstrained. The whole technique, start to
finish, for ground with nothing already standing near it.

### `pub fn grafting_procgen_irregular_grid::build_triangle_hex(options: grafting_procgen_irregular_grid::hex::TriangleHexOptions) -> grafting_procgen_irregular_grid::mesh::FaceMesh`

A hexagon rather than a square because hexagons tile the plane while each
one stays a self-contained chunk, which is what later lets the grid extend
indefinitely with each chunk seeded from its own coordinates.

This is the *unconstrained* first stage, kept whole after the constrained
one arrived beside it: a stroke landing on empty ground has nothing to be
constrained by, and paying for a triangulation to discover that is waste.
[`crate::constrained`] is the same stage where something already stands.

### `pub fn grafting_procgen_irregular_grid::constrained::locate_on_contour(options: &grafting_procgen_irregular_grid::constrained::ConstrainedOptions, point: grafting_procgen_irregular_grid::mesh::Vec2, tolerance: f64) -> core::option::Option<grafting_procgen_irregular_grid::constrained::ContourLocation>`

Which contour segment `point` sits on, if any.

The nearest one wins where several are within `tolerance`, which happens
at a ring corner -- both segments meeting there contain the point, and
either is a correct answer since the corner is a node both already share.

### `pub fn grafting_procgen_irregular_grid::constrained::triangulate_constrained(options: &grafting_procgen_irregular_grid::constrained::ConstrainedOptions) -> core::option::Option<grafting_procgen_irregular_grid::constrained::ConstrainedTriangles>`

Triangulates the ground `options.boundary` encloses and `options.holes`
take back, refined to the cell scale.

Returns `None` only when the constraints cannot form a triangulation at
all -- fewer than three distinct points, or coordinates the exact
predicates refuse (infinite, NaN, or beyond the representable range). A
caller that gets `None` has ground it cannot describe, and should leave
what is standing alone rather than substitute something.

### `pub fn grafting_procgen_irregular_grid::geometry::centroid_of(points: &[grafting_procgen_irregular_grid::mesh::Vec2]) -> grafting_procgen_irregular_grid::mesh::Vec2`

The average of a set of points.

### `pub fn grafting_procgen_irregular_grid::geometry::distance_to_segment(point: grafting_procgen_irregular_grid::mesh::Vec2, from: grafting_procgen_irregular_grid::mesh::Vec2, to: grafting_procgen_irregular_grid::mesh::Vec2) -> f64`

Shortest distance from `point` to the finite segment `from`-`to`.

### `pub fn grafting_procgen_irregular_grid::geometry::inside_ring(ring: &[grafting_procgen_irregular_grid::mesh::Vec2], point: grafting_procgen_irregular_grid::mesh::Vec2) -> bool`

Even-odd containment against one closed ring.

### `pub fn grafting_procgen_irregular_grid::geometry::signed_area(a: grafting_procgen_irregular_grid::mesh::Vec2, b: grafting_procgen_irregular_grid::mesh::Vec2, c: grafting_procgen_irregular_grid::mesh::Vec2) -> f64`

Twice the signed area of the triangle `a b c` -- positive counter-clockwise.

Only ever read for its sign here, to normalise winding. This is a plain
float determinant and not an exact predicate on purpose: spade has already
decided the topology by the time anything in this crate looks at winding,
so a wrong answer on a triangle of near-zero area costs a face that carries
no ground either way.

### `pub fn grafting_procgen_irregular_grid::hex::build_triangle_hex(options: grafting_procgen_irregular_grid::hex::TriangleHexOptions) -> grafting_procgen_irregular_grid::mesh::FaceMesh`

A hexagon rather than a square because hexagons tile the plane while each
one stays a self-contained chunk, which is what later lets the grid extend
indefinitely with each chunk seeded from its own coordinates.

This is the *unconstrained* first stage, kept whole after the constrained
one arrived beside it: a stroke landing on empty ground has nothing to be
constrained by, and paying for a triangulation to discover that is waste.
[`crate::constrained`] is the same stage where something already stands.

### `pub fn grafting_procgen_irregular_grid::hex::lattice_covering(min: grafting_procgen_irregular_grid::mesh::Vec2, max: grafting_procgen_irregular_grid::mesh::Vec2, triangle_side: f64) -> alloc::vec::Vec<grafting_procgen_irregular_grid::mesh::Vec2>`

The same equilateral lattice [`build_triangle_hex`] lays, as loose points
covering an axis-aligned box.

What the constrained stage seeds itself with. Refinement on its own
produces a mesh of good *quality*, which is not the same as a mesh that
looks like the rest of the world -- left to itself it would fill a wide
area with whatever spacing satisfies the area limit, and ground
regenerated beside a road would read as a different material. Seeding it
with this lattice, at the same `triangle_side` the unconstrained stage
uses, means the interior comes out with the spacing it has everywhere
else and only the band near a contour adapts.

The box is covered generously by one row and column on each side: a seed
just outside it can still be a corner of a triangle that reaches inside,
and the caller drops whatever falls outside the ground anyway.

### `pub fn grafting_procgen_irregular_grid::hex::lattice_triangle_area(triangle_side: f64) -> f64`

The area of one triangle of the lattice at `triangle_side`.

The refinement area limit the constrained stage runs at, so its triangles
come out the size the unconstrained lattice would have made them. Stated
as a function rather than left to the caller to work out, because getting
it wrong is invisible until the ground is on screen next to ground made
the other way.

### `pub fn grafting_procgen_irregular_grid::mesh::Vec2::new(x: f64, y: f64) -> Self`

### `pub fn grafting_procgen_irregular_grid::mesh::edge_key(a: usize, b: usize) -> (usize, usize)`

Undirected, so the two faces sharing an edge agree on its name.

### `pub fn grafting_procgen_irregular_grid::mesh::edges_of(face: &[usize]) -> alloc::vec::Vec<(usize, usize)>`

A face's edges as ordered index pairs, wrapping at the end.

### `pub fn grafting_procgen_irregular_grid::ortho::ortho(mesh: &grafting_procgen_irregular_grid::mesh::FaceMesh) -> grafting_procgen_irregular_grid::mesh::QuadMesh`

Step 3 -- Conway's ortho operator: every face becomes quads.

A face of `n` sides yields `n` quads, each spanning one corner, the two
adjacent edge midpoints, and the face centre. A triangle becomes three
quads and a rhombus four, so nothing has to be done about faces that never
found a partner -- the mesh is all-quad regardless of how the pairing went.

### `pub fn grafting_procgen_irregular_grid::ortho::weld(mesh: &grafting_procgen_irregular_grid::mesh::QuadMesh, epsilon: f64) -> grafting_procgen_irregular_grid::mesh::QuadMesh`

Step 4 -- merge coincident vertices.

Required before relaxation rather than merely tidy: each face produced its
own copy of every shared edge midpoint, and until those are one vertex,
smoothing moves each copy independently and tears the mesh apart.

### `pub fn grafting_procgen_irregular_grid::ortho::weld_tracked(mesh: &grafting_procgen_irregular_grid::mesh::QuadMesh, epsilon: f64) -> (grafting_procgen_irregular_grid::mesh::QuadMesh, alloc::vec::Vec<usize>)`

[`weld`], plus where each vertex went.

`remap[before] == after`. A caller carrying per-vertex facts the mesh
itself does not hold -- which node of the graph a corner already is --
needs this, and deriving it afterwards would mean matching positions,
which is the one thing this whole approach exists to avoid.

### `pub fn grafting_procgen_irregular_grid::pair::pair_triangles(mesh: &grafting_procgen_irregular_grid::mesh::FaceMesh, random: &mut grafting_procgen_irregular_grid::random::Random) -> grafting_procgen_irregular_grid::mesh::FaceMesh`

This is the step that makes the result irregular, and it is purely
aesthetic: whatever stays unpaired is handled by [`crate::ortho::ortho`]
anyway. The matching is greedy over a shuffled order, which leaves some
triangles unpaired by construction -- that variation is the point, so no
attempt is made to maximise the matching.

### `pub fn grafting_procgen_irregular_grid::random::Random::new(seed: u32) -> Self`

### `pub fn grafting_procgen_irregular_grid::random::Random::next(&mut self) -> f64`

The next value in `[0, 1)`.

### `pub fn grafting_procgen_irregular_grid::random::Random::shuffle<T>(&mut self, items: &mut [T])`

Fisher-Yates, drawing in the same order as the original so a given
seed shuffles a given list identically.

### `pub fn grafting_procgen_irregular_grid::random::Random::shuffled_indices(&mut self, length: usize) -> alloc::vec::Vec<usize>`

`0..length` shuffled.

### `pub fn grafting_procgen_irregular_grid::relax(mesh: &grafting_procgen_irregular_grid::mesh::QuadMesh, options: &grafting_procgen_irregular_grid::relax::RelaxOptions) -> grafting_procgen_irregular_grid::mesh::QuadMesh`

For each quad the best-fit square sharing its centre is found by rotating
each corner back by its own quarter-turn and averaging: in a true square
all four land on the same point, so how far they disagree is exactly how
far the cell is from square. Corners then move toward where that square
puts them.

Because every vertex is pulled by all the cells it belongs to, the result
is a compromise -- cells become square-ish while the irregular layout
survives. Averaging positions toward neighbours instead (ordinary
Laplacian smoothing) would shrink the mesh and say nothing about the shape
of a cell.

### `pub fn grafting_procgen_irregular_grid::relax::RelaxOptions::standard() -> Self`

The settings a free-standing chunk relaxes with.

### `pub fn grafting_procgen_irregular_grid::relax::boundary_vertices(mesh: &grafting_procgen_irregular_grid::mesh::QuadMesh) -> std::collections::hash::set::HashSet<usize>`

Vertices on an edge belonging to exactly one quad.

### `pub fn grafting_procgen_irregular_grid::relax::relax(mesh: &grafting_procgen_irregular_grid::mesh::QuadMesh, options: &grafting_procgen_irregular_grid::relax::RelaxOptions) -> grafting_procgen_irregular_grid::mesh::QuadMesh`

For each quad the best-fit square sharing its centre is found by rotating
each corner back by its own quarter-turn and averaging: in a true square
all four land on the same point, so how far they disagree is exactly how
far the cell is from square. Corners then move toward where that square
puts them.

Because every vertex is pulled by all the cells it belongs to, the result
is a compromise -- cells become square-ish while the irregular layout
survives. Averaging positions toward neighbours instead (ordinary
Laplacian smoothing) would shrink the mesh and say nothing about the shape
of a cell.

### `pub grafting_procgen_irregular_grid::ConstrainedQuadGrid::mesh: grafting_procgen_irregular_grid::mesh::QuadMesh`

### `pub grafting_procgen_irregular_grid::ConstrainedQuadGrid::on_contour: alloc::vec::Vec<grafting_procgen_irregular_grid::ContourNode>`

Corners that sit *on* a contour the caller supplied but arrived with
no source of their own, each with the segment it landed on.

These are the nodes the owning cloud has to accept along its own
boundary. Two things make them: the refinement splitting a constraint
segment, and `ortho` putting a midpoint on every edge it
quadrangulates -- a contour edge included. Both are wanted. The
alternative to a shared node here is a terrain corner resting against
the middle of a road edge without sharing it, which is the T-junction
that reads as a gap along the path.

The segment is named rather than left for the caller to find, because
finding it means matching a position to an edge, which is the guess
this whole design removes. The caller supplied the rings, so a ring
and segment index is already an edge it knows by id.

### `pub grafting_procgen_irregular_grid::ConstrainedQuadGrid::refinement_complete: bool`

`false` where the refinement stopped at its vertex budget.

### `pub grafting_procgen_irregular_grid::ConstrainedQuadGrid::sources: alloc::vec::Vec<core::option::Option<u32>>`

Index-aligned with `mesh.vertices`: the caller own identity for that
corner, where it had one. `None` is new ground.

### `pub grafting_procgen_irregular_grid::ContourNode::location: grafting_procgen_irregular_grid::constrained::ContourLocation`

### `pub grafting_procgen_irregular_grid::ContourNode::vertex: usize`

Index into [`ConstrainedQuadGrid::mesh`]'s own vertices.

### `pub grafting_procgen_irregular_grid::FaceMesh::faces: alloc::vec::Vec<grafting_procgen_irregular_grid::mesh::Face>`

### `pub grafting_procgen_irregular_grid::FaceMesh::vertices: alloc::vec::Vec<grafting_procgen_irregular_grid::mesh::Vec2>`

### `pub grafting_procgen_irregular_grid::IrregularQuadGridOptions::hex: grafting_procgen_irregular_grid::hex::TriangleHexOptions`

### `pub grafting_procgen_irregular_grid::IrregularQuadGridOptions::relax: grafting_procgen_irregular_grid::relax::RelaxOptions`

### `pub grafting_procgen_irregular_grid::IrregularQuadGridOptions::seed: u32`

### `pub grafting_procgen_irregular_grid::QuadMesh::quads: alloc::vec::Vec<grafting_procgen_irregular_grid::mesh::Quad>`

### `pub grafting_procgen_irregular_grid::QuadMesh::vertices: alloc::vec::Vec<grafting_procgen_irregular_grid::mesh::Vec2>`

### `pub grafting_procgen_irregular_grid::RelaxOptions::iterations: u32`

Smoothing passes. Around 10-20 settles this grid.

### `pub grafting_procgen_irregular_grid::RelaxOptions::pin_boundary: bool`

Whether vertices on the outer boundary stay put.

A single chunk relaxed without pinning rounds off, because nothing
outside pulls back. Townscaper avoids this by relaxing across
overlapping neighbourhoods instead; pinning is the honest single-chunk
stand-in, and what a chunked implementation replaces.

### `pub grafting_procgen_irregular_grid::RelaxOptions::pinned_targets: std::collections::hash::map::HashMap<usize, grafting_procgen_irregular_grid::mesh::Vec2>`

Explicit pin targets, keyed by vertex index.

`pin_boundary` only ever holds a vertex at wherever the mesh happened
to place it -- which is all a *free-standing* chunk needs, since
nothing outside it is fixed yet either. A grid generated against
contours another cloud already committed to is different: its rim must
land exactly on those, a position this mesh never produced on its own.
A vertex named here is held at the given position outright, the same
"excluded from the update" treatment `pin_boundary` gives its own
boundary -- easing toward it instead would leave a residual gap after
a fixed iteration count, and the whole point is landing *on* a
committed contour, not merely near it. Wins over `pin_boundary` for
the same vertex.

### `pub grafting_procgen_irregular_grid::RelaxOptions::strength: f64`

Fraction of the way to the target each pass moves a vertex.

### `pub grafting_procgen_irregular_grid::TriangleHexOptions::triangle_side: f64`

Edge length of one equilateral triangle.

### `pub grafting_procgen_irregular_grid::TriangleHexOptions::triangles_per_side: u32`

Triangles along one hexagon edge. Sylves' walkthrough uses `4`.

### `pub grafting_procgen_irregular_grid::Vec2::x: f64`

### `pub grafting_procgen_irregular_grid::Vec2::y: f64`

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedOptions::boundary: alloc::vec::Vec<alloc::vec::Vec<grafting_procgen_irregular_grid::constrained::ConstraintPoint>>`

Closed rings bounding the ground being generated, each implicitly
closed from its last point back to its first.

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedOptions::holes: alloc::vec::Vec<alloc::vec::Vec<grafting_procgen_irregular_grid::constrained::ConstraintPoint>>`

Closed rings of ground somebody else already holds -- a road contour,
a building footprint -- subtracted from [`Self::boundary`].

Kept separate from the boundary rather than folded in as more rings of
one list, and the distinction is not cosmetic. Odd winding over one
combined list gets a hole *inside* the ground right and a hole that
crosses clean through it wrong: the part of a road that overshoots the
ground it cuts winds once, reads as odd, and would come back as ground
that was never there. Ground is `boundary AND NOT holes`, which is
what these two fields say and one list cannot.

Every ring is a constraint either way -- no triangle crosses one,
whichever list it came from. This only decides which of the resulting
faces are handed back.

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedOptions::max_additional_vertices: usize`

Hard ceiling on points the refinement may invent, so a pathological
contour costs a worse mesh rather than an unbounded loop.

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedOptions::max_area: f64`

Largest triangle the refinement will leave standing. The cell scale.

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedOptions::min_angle_degrees: f64`

Smallest angle the refinement will leave standing, in degrees.

Ruppert is only proven to terminate below roughly 20.7 degrees; above
that it may keep splitting until it runs out of its vertex budget. 30
is the value it is normally used at in practice, with the budget as
the guard rail behind it.

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedOptions::min_area: f64`

Smallest triangle the refinement will bother to improve. `0` disables
the floor.

This is the guard against the one input that actually costs: two
contours running close and near-parallel. The local feature size
between them collapses, and without a floor the refinement fills the
wedge with slivers -- measured at three times the whole area's worth
of cells for a gap of a fortieth of one. With a floor at 15% of
[`Self::max_area`] that case loses two thirds of its cells and half
its time, while every input *without* such a wedge comes back cell for
cell identical. It buys the pathological case and costs the ordinary
one nothing, which is why it is on by default at the bridge.

A sharp *angle* alone is not the problem it is often assumed to be:
measured, a three degree wedge costs about five percent.

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedOptions::seed_clearance: f64`

How close to a constraint a seed may fall before it is dropped.

A lattice point landing all but on a contour makes a sliver the
refinement then has to work to remove. Cheaper to not create it.

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedOptions::seeds: alloc::vec::Vec<grafting_procgen_irregular_grid::mesh::Vec2>`

Interior points to seed the triangulation with, before refinement.

This is what keeps the result looking like the rest of the world. The
refinement on its own produces a *quality* mesh, not this particular
one; seeding it with the same equilateral lattice the unconstrained
stage uses means the interior comes out with the lattice spacing, and
only the band near a contour adapts.

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedTriangles::mesh: grafting_procgen_irregular_grid::mesh::FaceMesh`

Triangles only, wound counter-clockwise, ready for the shared tail of
the pipeline ([`crate::build_from_triangles`]).

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedTriangles::refinement_complete: bool`

`false` where the refinement hit `max_additional_vertices` and stopped
early. The mesh is still usable -- just coarser somewhere.

### `pub grafting_procgen_irregular_grid::constrained::ConstrainedTriangles::sources: alloc::vec::Vec<core::option::Option<u32>>`

Index-aligned with `mesh.vertices`: the [`ConstraintPoint::source`]
that vertex arrived with, or `None` where the triangulation made it.

### `pub grafting_procgen_irregular_grid::constrained::ConstraintPoint::position: grafting_procgen_irregular_grid::mesh::Vec2`

### `pub grafting_procgen_irregular_grid::constrained::ConstraintPoint::source: core::option::Option<u32>`

The caller's own identity for this point, carried through untouched.

An index into whatever table the caller keeps, never a node id itself:
this crate stays free of any particular graph's identifier type, the
same way it stays free of elevation.

### `pub grafting_procgen_irregular_grid::constrained::ContourLocation::in_holes: bool`

`false` for a ring of `boundary`, `true` for one of `holes`.

### `pub grafting_procgen_irregular_grid::constrained::ContourLocation::ring: usize`

Index of the ring within whichever of the two lists.

### `pub grafting_procgen_irregular_grid::constrained::ContourLocation::segment: usize`

Index of the segment within that ring, by the point it starts at.

### `pub grafting_procgen_irregular_grid::hex::TriangleHexOptions::triangle_side: f64`

Edge length of one equilateral triangle.

### `pub grafting_procgen_irregular_grid::hex::TriangleHexOptions::triangles_per_side: u32`

Triangles along one hexagon edge. Sylves' walkthrough uses `4`.

### `pub grafting_procgen_irregular_grid::mesh::FaceMesh::faces: alloc::vec::Vec<grafting_procgen_irregular_grid::mesh::Face>`

### `pub grafting_procgen_irregular_grid::mesh::FaceMesh::vertices: alloc::vec::Vec<grafting_procgen_irregular_grid::mesh::Vec2>`

### `pub grafting_procgen_irregular_grid::mesh::QuadMesh::quads: alloc::vec::Vec<grafting_procgen_irregular_grid::mesh::Quad>`

### `pub grafting_procgen_irregular_grid::mesh::QuadMesh::vertices: alloc::vec::Vec<grafting_procgen_irregular_grid::mesh::Vec2>`

### `pub grafting_procgen_irregular_grid::mesh::Vec2::x: f64`

### `pub grafting_procgen_irregular_grid::mesh::Vec2::y: f64`

### `pub grafting_procgen_irregular_grid::relax::RelaxOptions::iterations: u32`

Smoothing passes. Around 10-20 settles this grid.

### `pub grafting_procgen_irregular_grid::relax::RelaxOptions::pin_boundary: bool`

Whether vertices on the outer boundary stay put.

A single chunk relaxed without pinning rounds off, because nothing
outside pulls back. Townscaper avoids this by relaxing across
overlapping neighbourhoods instead; pinning is the honest single-chunk
stand-in, and what a chunked implementation replaces.

### `pub grafting_procgen_irregular_grid::relax::RelaxOptions::pinned_targets: std::collections::hash::map::HashMap<usize, grafting_procgen_irregular_grid::mesh::Vec2>`

Explicit pin targets, keyed by vertex index.

`pin_boundary` only ever holds a vertex at wherever the mesh happened
to place it -- which is all a *free-standing* chunk needs, since
nothing outside it is fixed yet either. A grid generated against
contours another cloud already committed to is different: its rim must
land exactly on those, a position this mesh never produced on its own.
A vertex named here is held at the given position outright, the same
"excluded from the update" treatment `pin_boundary` gives its own
boundary -- easing toward it instead would leave a residual gap after
a fixed iteration count, and the whole point is landing *on* a
committed contour, not merely near it. Wins over `pin_boundary` for
the same vertex.

### `pub grafting_procgen_irregular_grid::relax::RelaxOptions::strength: f64`

Fraction of the way to the target each pass moves a vertex.

### `pub mod grafting_procgen_irregular_grid`

Townscaper-style irregular quad grid.

The substrate buildable ground sits on. The organic quality does not come
from any later solve -- it comes from here: pairing triangles at random
before quadrangulating gives cells that vary in size and orientation, and
relaxation then pulls them back toward squares without restoring the
regularity. Build on a plain square grid and it works perfectly and looks
like a chessboard.

The algorithm follows the sequence documented in Boris The Brave's Sylves
tutorial (<https://boristhebrave.com/docs/sylves/1/articles/tutorials/townscaper.html>),
itself a walkthrough of Oskar Stalberg's technique. Written from that
description rather than adapted from any implementation's source.

Ported from `apps/vtt/src/features/edit-construction/topology/irregular-grid.ts`,
which it replaces. Bit-for-bit compatible on the unconstrained path
(see [`random::Random`]) so ground already generated keeps generating the
same way.

**The five steps**, and why the first one is now pluggable:

```text
triangulate -> pair into rhombi -> ortho -> weld -> relax
```

Steps 2 to 5 are what makes the grid look the way it does, and they are
indifferent to where the triangles came from. Step 1 is not: a stroke on
empty ground wants the equilateral hexagon lattice ([`hex`]), while ground
that has to meet contours another cloud already committed to wants those
contours held as edges no triangle may cross ([`constrained`]).

That split is the whole reason this crate exists as one piece rather than
two. Regenerating ground around a road is not a repair with its own
algorithm -- it is this same pipeline, with the road's contour named as a
constraint. Creation and regeneration are one code path or they drift.

### `pub mod grafting_procgen_irregular_grid::constrained`

Step 1 (constrained) -- triangles that stop at contours somebody else owns.

The unconstrained stage ([`crate::hex`]) lays an equilateral lattice and
knows nothing about what is already standing. That is right for a stroke
on empty ground and wrong for everything else: ground meeting a road has
to meet it *exactly*, on the road's own nodes, along the road's own edges.

A constrained Delaunay triangulation is that guarantee, rather than an
approximation of it. Contour edges are declared as constraints, and no
triangle may cross one -- so "the terrain stops at the road" is a property
of the triangulation, not something checked afterwards and patched where
it failed.

**Why the caller's node ids come back out.** Every generated fill this
replaces failed the same way: a geometry library answered in *positions*,
and the code then had to work out which existing node each position was,
by proximity. That guess is what minted a second node on top of a real one
and left seams that looked joined and were not. Here a constraint vertex
carries its [`ConstraintPoint::source`] through the triangulation and comes
back still carrying it. There is no matching step, so there is nothing to
get wrong. A vertex that comes back with `None` is genuinely new ground --
interior the refinement invented, or a junction where two contours cross --
and the caller mints a node for it knowing exactly that.

**Refinement may split a contour.** Ruppert's algorithm inserts points on a
constraint segment when a nearby vertex encroaches on it. That is wanted,
not tolerated: the alternative is a terrain vertex sitting against the
middle of a road edge without sharing it, which is a T-junction -- the
precise shape of the "gap along the path" this whole approach exists to
remove. The cloud that owns the contour has to accept nodes appearing
along its boundary; in exchange nothing is ever merely near anything.

### `pub mod grafting_procgen_irregular_grid::geometry`

The plane primitives every stage of the pipeline shares.

One module rather than a copy wherever one was needed. There are already
four hand-rolled point-in-polygon tests across this workspace
(`surface-mesh::math::point_in_loop_xz`,
`surface-transformations::point_in_footprint`, and the two the TypeScript
side keeps), and adding a fifth scattered across this crate is how that
happens again.

**Why these are not simply the existing ones.** Every primitive already in
the workspace is `f32`, and this crate cannot be. Two independent reasons:
spade decides face orientation with exact predicates over `f64`, which is
the entire robustness argument for using it; and the parity fixture holds
the TypeScript generator own output, where every number was a `f64`, so a
single `f32` rounding anywhere in the pipeline breaks bit-exactness with
ground already saved in real tables.

Consolidating these with their `f32` cousins therefore means making the
others generic over the scalar, which is a workspace-wide change and does
not belong to the terrain work. Kept together and named here so that
refactor has one place to come and take them from.

### `pub mod grafting_procgen_irregular_grid::hex`

Step 1 (unconstrained) -- a hexagon filled with equilateral triangles.

### `pub mod grafting_procgen_irregular_grid::mesh`

The two mesh forms the pipeline moves between, and the handful of
index-level helpers every stage shares.

### `pub mod grafting_procgen_irregular_grid::ortho`

Steps 3 and 4 -- quadrangulation, then merging the duplicates it emits.

### `pub mod grafting_procgen_irregular_grid::pair`

Step 2 -- randomly merge adjacent triangles into rhombi.

### `pub mod grafting_procgen_irregular_grid::random`

The seeded 0..1 source the whole pipeline draws from.

### `pub mod grafting_procgen_irregular_grid::relax`

Step 5 -- pull every cell toward a square without regularising the grid.

### `pub struct grafting_procgen_irregular_grid::ConstrainedQuadGrid`

A grid, and what each of its corners already is.

### `pub struct grafting_procgen_irregular_grid::ContourNode`

One corner the grid put along a contour somebody else owns.

### `pub struct grafting_procgen_irregular_grid::FaceMesh`

A mesh of arbitrary faces -- the intermediate form before quadrangulation.

### `pub struct grafting_procgen_irregular_grid::IrregularQuadGridOptions`

Everything [`build_irregular_quad_grid`] needs.

### `pub struct grafting_procgen_irregular_grid::QuadMesh`

The finished all-quad grid.

### `pub struct grafting_procgen_irregular_grid::Random`

Deterministic 0..1 generator (mulberry32).

Determinism is not a convenience here. The map is replicated authoritative
state, so two hosts generating "the same" grid must produce identical
vertices, and a grid that depends on ambient randomness cannot be
regenerated from a saved seed.

**Bit-for-bit identical to the TypeScript original it replaces**, and
deliberately so: a grid already committed to a saved table has to keep
generating the same way after the port, or every existing map shifts under
its own terrain. `Math.imul` is a wrapping 32-bit multiply, `>>> 0` is a
reinterpretation as `u32`, and the one float addition in the mix stays
exact because the sum of two 32-bit integers is representable in `f64` --
so `wrapping_add` agrees with it on every bit that survives.

### `pub struct grafting_procgen_irregular_grid::RelaxOptions`

Options for [`relax`].

### `pub struct grafting_procgen_irregular_grid::TriangleHexOptions`

Options for [`build_triangle_hex`].

### `pub struct grafting_procgen_irregular_grid::Vec2`

A point on the grid plane.

Plane coordinates, not world ones: the caller decides that `y` here is
world Z, and supplies height separately. Nothing in this crate knows about
elevation.

### `pub struct grafting_procgen_irregular_grid::constrained::ConstrainedOptions`

What bounds the ground being generated.

### `pub struct grafting_procgen_irregular_grid::constrained::ConstrainedTriangles`

The triangles, and where each of their corners came from.

### `pub struct grafting_procgen_irregular_grid::constrained::ConstraintPoint`

One point of a contour handed over as a constraint.

### `pub struct grafting_procgen_irregular_grid::constrained::ContourLocation`

Where on a supplied contour a point sits.

Not a boolean, because the caller needs to *act* on it. A node the grid
puts along a neighbour edge has to be adopted by that neighbour, and
adopting it means splitting the exact edge it landed on. Answering "yes,
somewhere" would send the caller back to finding that edge by position,
which is the proximity guess this whole design exists to remove: the
segment is named here, and the caller supplied the rings, so it already
knows which of its own edges that is.

### `pub struct grafting_procgen_irregular_grid::hex::TriangleHexOptions`

Options for [`build_triangle_hex`].

### `pub struct grafting_procgen_irregular_grid::mesh::FaceMesh`

A mesh of arbitrary faces -- the intermediate form before quadrangulation.

### `pub struct grafting_procgen_irregular_grid::mesh::QuadMesh`

The finished all-quad grid.

### `pub struct grafting_procgen_irregular_grid::mesh::Vec2`

A point on the grid plane.

Plane coordinates, not world ones: the caller decides that `y` here is
world Z, and supplies height separately. Nothing in this crate knows about
elevation.

### `pub struct grafting_procgen_irregular_grid::random::Random`

Deterministic 0..1 generator (mulberry32).

Determinism is not a convenience here. The map is replicated authoritative
state, so two hosts generating "the same" grid must produce identical
vertices, and a grid that depends on ambient randomness cannot be
regenerated from a saved seed.

**Bit-for-bit identical to the TypeScript original it replaces**, and
deliberately so: a grid already committed to a saved table has to keep
generating the same way after the port, or every existing map shifts under
its own terrain. `Math.imul` is a wrapping 32-bit multiply, `>>> 0` is a
reinterpretation as `u32`, and the one float addition in the mix stays
exact because the sum of two 32-bit integers is representable in `f64` --
so `wrapping_add` agrees with it on every bit that survives.

### `pub struct grafting_procgen_irregular_grid::relax::RelaxOptions`

Options for [`relax`].

### `pub type grafting_procgen_irregular_grid::Face = alloc::vec::Vec<usize>`

A face as indices into a vertex list, in cyclic order.

### `pub type grafting_procgen_irregular_grid::Quad = [usize; 4]`

A face known to have exactly four vertices.

### `pub type grafting_procgen_irregular_grid::mesh::Face = alloc::vec::Vec<usize>`

A face as indices into a vertex list, in cyclic order.

### `pub type grafting_procgen_irregular_grid::mesh::Quad = [usize; 4]`

A face known to have exactly four vertices.
