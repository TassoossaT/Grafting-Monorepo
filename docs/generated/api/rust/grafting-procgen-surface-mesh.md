# grafting-procgen-surface-mesh

### `pub const grafting_procgen_surface_mesh::ARC_TESSELLATION_TOLERANCE: f32`

Maximum deviation, in world units, between a tessellated arc's chords and
the true circle they approximate -- see this crate's top-level doc for why
this is a fixed constant here rather than a caller-supplied value: nothing
upstream of rendering has a legitimate reason to care about tessellation
resolution.

### `pub const grafting_procgen_surface_mesh::VERTICAL_SIDE_EPSILON: f32`

How far apart, in world units, an edge's two endpoints may be in XZ and
still count as one upright side for `upright_face_mesh`. Only ever
compared against values that are meant to be exactly equal (the same
contour point at two heights), so this absorbs float round-trip drift,
not any real slant.

### `pub const grafting_procgen_surface_mesh::types::ARC_TESSELLATION_TOLERANCE: f32`

Maximum deviation, in world units, between a tessellated arc's chords and
the true circle they approximate -- see this crate's top-level doc for why
this is a fixed constant here rather than a caller-supplied value: nothing
upstream of rendering has a legitimate reason to care about tessellation
resolution.

### `pub const grafting_procgen_surface_mesh::types::VERTICAL_SIDE_EPSILON: f32`

How far apart, in world units, an edge's two endpoints may be in XZ and
still count as one upright side for `upright_face_mesh`. Only ever
compared against values that are meant to be exactly equal (the same
contour point at two heights), so this absorbs float round-trip drift,
not any real slant.

### `pub enum grafting_procgen_surface_mesh::frame::UnrollFrame`

The flat frame an upright face unrolls into: one coordinate running
along its rail, one running up it.

A wall panel is developable, so this map loses nothing. `Chord` is the
straight case and `Cylinder` the curved one, and they are the same idea
-- a chord is an arc whose radius has gone to infinity.

### `pub fn grafting_procgen_surface_mesh::frame::UnrollFrame::normal_at(&self, point: [f32; 3]) -> [f32; 3]`

The outward horizontal direction at `point` -- radial for a cylinder,
constant for a chord.

### `pub fn grafting_procgen_surface_mesh::frame::UnrollFrame::of(geometry: &grafting_graph_core::contour::ContourGeometry, start: [f32; 3], end: [f32; 3]) -> core::option::Option<Self>`

Builds the frame from the rail's own geometry and where that rail starts.

### `pub fn grafting_procgen_surface_mesh::frame::UnrollFrame::roll(&self, unrolled: [f32; 2]) -> [f32; 3]`

The inverse of [`unroll`](Self::unroll): a point on the flattened face
put back onto the surface it came from.

What makes it worth having is that the flat place is where a
triangulator is allowed to invent vertices. One it invents has no
counterpart in the contour, so the only way back onto the wall is to
roll it there.

### `pub fn grafting_procgen_surface_mesh::frame::UnrollFrame::unroll(&self, point: [f32; 3]) -> [f32; 2]`

`point` as (distance along the rail, height). Distance grows the way
the rail is walked, so the whole face lands on one side of the origin.

### `pub fn grafting_procgen_surface_mesh::math::angle_xz(center: [f32; 2], point: [f32; 2]) -> f32`

### `pub fn grafting_procgen_surface_mesh::math::cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3]`

### `pub fn grafting_procgen_surface_mesh::math::distance_xz(a: [f32; 2], b: [f32; 2]) -> f32`

### `pub fn grafting_procgen_surface_mesh::math::dot(a: [f32; 3], b: [f32; 3]) -> f32`

### `pub fn grafting_procgen_surface_mesh::math::face_normal(positions: &[[f32; 3]]) -> core::option::Option<[f32; 3]>`

Flat face normal for shading: the first non-degenerate cross product
among triples anchored at `positions[0]`. `project3d_to_2d` already
proved the ring is not globally degenerate before this runs, so this is
just picking a representative triple, not re-deriving planarity.

### `pub fn grafting_procgen_surface_mesh::math::point_in_loop_xz(point: [f32; 2], loop_: &[[f32; 3]]) -> bool`

### `pub fn grafting_procgen_surface_mesh::math::sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3]`

### `pub fn grafting_procgen_surface_mesh::math::sweep(from: f32, to: f32, clockwise: bool) -> f32`

Sweep from `from` to `to` in the given direction, always non-negative.

### `pub fn grafting_procgen_surface_mesh::math::winding_normal(positions: &[[f32; 3]], indices: &[u32]) -> core::option::Option<[f32; 3]>`

The normal of the first triangle with real area -- what the winding says
the face is facing.

### `pub fn grafting_procgen_surface_mesh::planar::triangulate_contour_loops<'a>(outer: &[[f32; 3]], holes: impl core::iter::traits::collect::IntoIterator<Item = &'a alloc::vec::Vec<[f32; 3]>>) -> core::option::Option<grafting_procgen_surface_mesh::types::TriangulatedMesh>`

Triangulates a planar surface consisting of an outer boundary loop and
optional hole loops.

### `pub fn grafting_procgen_surface_mesh::refine::field_owns_loops<'a>(fill: &grafting_procgen_surface_mesh::types::PlanarFill<'_>, loops: impl core::iter::traits::collect::IntoIterator<Item = &'a [[f32; 3]]>) -> bool`

Whether `fill`'s field claims every corner of these loops.

All of them, not most: a field that owns only part of a face would
elevate and parametrize that part on a different authority from the
rest, and the seam between the two answers is worse than either answer
alone. Unanimous or not at all.

### `pub fn grafting_procgen_surface_mesh::refine::needs_interior(outer: &[[f32; 3]], fill: &grafting_procgen_surface_mesh::types::PlanarFill<'_>) -> bool`

The largest triangle the ring could be covered by without any interior
vertex at all -- its own area. Below `fill.max_area` the refinement would
add nothing, so the cheap boundary-only path is not merely adequate, it
is identical, and this is what lets the caller skip straight past.

### `pub fn grafting_procgen_surface_mesh::refine::refined_planar_mesh(outer: &[[f32; 3]], holes: &[&alloc::vec::Vec<[f32; 3]>], fill: &grafting_procgen_surface_mesh::types::PlanarFill<'_>) -> core::option::Option<grafting_procgen_surface_mesh::types::TriangulatedMesh>`

Triangulates `outer` (less `holes`) with interior vertices, elevating and
parametrizing everything it invents from `fill`'s field.

Returns `None` when the constraints cannot be triangulated at all, which
the caller reads as "mesh this the way it was meshed before" rather than
as a failure -- a degenerate ring mid-edit is a transient state.

### `pub fn grafting_procgen_surface_mesh::tessellation::tessellate_contour_loop(topology: &grafting_graph_core::contour::ContourTopology, loop_: &grafting_graph_core::contour::ContourLoop, resolve_position: &mut impl core::ops::function::FnMut(&grafting_graph_core::model::NodeId) -> core::option::Option<[f32; 3]>) -> core::option::Option<alloc::vec::Vec<[f32; 3]>>`

Discretizes a loop of analytic contour edges into 3D world points.

### `pub fn grafting_procgen_surface_mesh::tessellation::traversed_edge(topology: &grafting_graph_core::contour::ContourTopology, use_: &grafting_graph_core::contour::OrientedEdgeUse) -> core::option::Option<grafting_graph_core::contour::ContourEdge>`

One loop entry resolved into an edge that runs the way the loop
traverses it -- a reversed use is rebuilt with its endpoints swapped and
its geometry mirrored, so every caller downstream can read `start_node`
and `end_node` literally.

### `pub fn grafting_procgen_surface_mesh::triangulate_region(topology: &grafting_graph_core::contour::ContourTopology, region: &grafting_graph_core::contour::SurfaceRegion, resolve_position: impl core::ops::function::FnMut(&grafting_graph_core::model::NodeId) -> core::option::Option<[f32; 3]>) -> core::option::Option<alloc::vec::Vec<grafting_procgen_surface_mesh::types::TriangulatedMesh>>`

Derives transient meshes for every outer loop in an analytic contour
region. Lines and circular arcs remain analytic in graph state; this is
the first point where an arc is approximated for GPU consumption.

Holes are assigned to the outer loop that contains their first point in
the XZ contour plane. An invalid hole that is outside every outer loop
produces `None` rather than a visually plausible but topologically false
mesh. Callers resolve node positions from their authoritative graph.

### `pub fn grafting_procgen_surface_mesh::triangulate_region_with(topology: &grafting_graph_core::contour::ContourTopology, region: &grafting_graph_core::contour::SurfaceRegion, resolve_position: impl core::ops::function::FnMut(&grafting_graph_core::model::NodeId) -> core::option::Option<[f32; 3]>, fill: core::option::Option<grafting_procgen_surface_mesh::types::PlanarFill<'_>>) -> core::option::Option<alloc::vec::Vec<grafting_procgen_surface_mesh::types::TriangulatedMesh>>`

[`triangulate_region`], with the option of filling a planar face's
interior rather than covering it from its own corners alone.

`fill` is the whole difference. Without it this is the function it always
was. With it, a planar face large enough to warrant an interior, and
whose every corner the field claims, is refined to a bounded triangle
size instead of ear-clipped -- which is what stops a ribbon swept along a
curve from being covered by diagonals running margin to margin, twisting
the surface and digging troughs the contour never had. See
[`refine`] for why that is a property of the face's shape rather than of
what kind of surface anybody thinks it is.

### `pub fn grafting_procgen_surface_mesh::types::PlanarFill<'a>::clone(&self) -> grafting_procgen_surface_mesh::types::PlanarFill<'a>`

### `pub fn grafting_procgen_surface_mesh::types::PlanarFill<'a>::fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result`

### `pub fn grafting_procgen_surface_mesh::types::PlanarFill<'a>::new(field: &'a grafting_graph_core::curve_offset::field::ReferenceField, max_area: f32) -> Self`

A fill on `field` at `max_area`, with the refinement settings the
constrained ground generator already runs at -- same triangulator,
same tuning, so a face and the ground beside it are meshed to
comparable density rather than to two unrelated opinions.

### `pub fn grafting_procgen_surface_mesh::upright::upright_face_mesh(topology: &grafting_graph_core::contour::ContourTopology, region: &grafting_graph_core::contour::SurfaceRegion, resolve_position: &mut impl core::ops::function::FnMut(&grafting_graph_core::model::NodeId) -> core::option::Option<[f32; 3]>) -> core::option::Option<grafting_procgen_surface_mesh::types::TriangulatedMesh>`

Meshes an upright face -- a wall panel, straight or curved, opened or
solid -- by unrolling it flat and triangulating there.

`None` for anything that is not one, which leaves every other region on
the ordinary projection path untouched. A region with more than one outer
loop is never one: those come from a merge, and a merge is flat.

### `pub fn grafting_procgen_surface_mesh::upright::upright_structure(topology: &grafting_graph_core::contour::ContourTopology, loop_: &grafting_graph_core::contour::ContourLoop, resolve_position: &mut impl core::ops::function::FnMut(&grafting_graph_core::model::NodeId) -> core::option::Option<[f32; 3]>) -> core::option::Option<grafting_procgen_surface_mesh::upright::UprightStructure>`

Reads a loop as an upright face: a run along the base, one side rising,
a run back along the top, one side coming down.

Recognised by structure rather than by counting edges, so a panel whose
base has since been subdivided -- a T-junction welding another wall onto
its side -- is still the same upright face it always was.

### `pub grafting_procgen_surface_mesh::PlanarFill::field: &'a grafting_graph_core::curve_offset::field::ReferenceField`

The curves the face was swept from -- its height and `(s, t)`
authority, and the thing that decides whether the face is its at all.

### `pub grafting_procgen_surface_mesh::PlanarFill::max_additional_vertices: usize`

Hard ceiling on invented points, so a pathological contour costs a
coarser mesh rather than an unbounded loop.

### `pub grafting_procgen_surface_mesh::PlanarFill::max_area: f32`

Largest triangle left standing, in world units squared. A face
smaller than this gains nothing from refinement and skips it.

### `pub grafting_procgen_surface_mesh::PlanarFill::min_angle_degrees: f64`

Smallest angle the refinement leaves standing. Ruppert only
terminates provably below about 20.7 degrees.

### `pub grafting_procgen_surface_mesh::PlanarFill::min_area_ratio: f64`

Smallest triangle worth improving, as a fraction of [`Self::max_area`]
-- the guard against two contours running close and near-parallel,
where local feature size collapses and an unfloored refinement fills
the wedge with slivers.

### `pub grafting_procgen_surface_mesh::PlanarFill::reach_slack: f32`

Multiplier on each curve's own reach when deciding whether the field
claims a corner, absorbing a mitre or a union vertex sitting a hair
outside the swept width.

### `pub grafting_procgen_surface_mesh::TriangulatedMesh::indices: alloc::vec::Vec<u32>`

### `pub grafting_procgen_surface_mesh::TriangulatedMesh::normals: alloc::vec::Vec<[f32; 3]>`

### `pub grafting_procgen_surface_mesh::TriangulatedMesh::positions: alloc::vec::Vec<[f32; 3]>`

### `pub grafting_procgen_surface_mesh::TriangulatedMesh::uvs: alloc::vec::Vec<[f32; 2]>`

Where each vertex sits on the surface's own flat extent, **in world
units** -- not normalised to `0..1`.

Metres rather than a unit box is the whole point. A normalised box
stretches: the same texture would cover a 2 m panel and a 10 m one
identically, so a caller would have to undo the normalisation with the
panel's size to get a uniform result, and two panels meeting at a
corner would disagree about where the pattern is. In metres, scale is
uniform everywhere for free, and a caller divides by whatever its own
tile size happens to be.

An upright face measures along its rail and up. A flat one measures
along and across the curve it was swept from -- `(s, t)`, from its
[`PlanarFill`] field -- or, with no such curve, in world `x` and `z`.
All three anchor on something the graph already fixes, so re-deriving
a mesh yields the same coordinates and neighbours that share an anchor
agree across the edge between them.

`(s, t)` is the one worth building on. World `xz` is the face's
*shadow*: it foreshortens wherever the surface is not level and says
nothing about where along a run a point sits. Distance travelled and
distance off, in metres, is the coordinate anything laid out over the
surface actually wants -- a course of replicated units, a marking, a
structure placed at a station -- and it survives the surface being
rebuilt, refined differently or widened, which a vertex index does
not.

### `pub grafting_procgen_surface_mesh::frame::UnrollFrame::Chord`

### `pub grafting_procgen_surface_mesh::frame::UnrollFrame::Chord::direction: [f32; 2]`

### `pub grafting_procgen_surface_mesh::frame::UnrollFrame::Chord::origin: [f32; 2]`

### `pub grafting_procgen_surface_mesh::frame::UnrollFrame::Cylinder`

### `pub grafting_procgen_surface_mesh::frame::UnrollFrame::Cylinder::center: [f32; 2]`

### `pub grafting_procgen_surface_mesh::frame::UnrollFrame::Cylinder::clockwise: bool`

### `pub grafting_procgen_surface_mesh::frame::UnrollFrame::Cylinder::radius: f32`

### `pub grafting_procgen_surface_mesh::frame::UnrollFrame::Cylinder::start_angle: f32`

### `pub grafting_procgen_surface_mesh::frame::UnrollFrame::Cylinder::total_sweep: f32`

### `pub grafting_procgen_surface_mesh::types::PlanarFill::field: &'a grafting_graph_core::curve_offset::field::ReferenceField`

The curves the face was swept from -- its height and `(s, t)`
authority, and the thing that decides whether the face is its at all.

### `pub grafting_procgen_surface_mesh::types::PlanarFill::max_additional_vertices: usize`

Hard ceiling on invented points, so a pathological contour costs a
coarser mesh rather than an unbounded loop.

### `pub grafting_procgen_surface_mesh::types::PlanarFill::max_area: f32`

Largest triangle left standing, in world units squared. A face
smaller than this gains nothing from refinement and skips it.

### `pub grafting_procgen_surface_mesh::types::PlanarFill::min_angle_degrees: f64`

Smallest angle the refinement leaves standing. Ruppert only
terminates provably below about 20.7 degrees.

### `pub grafting_procgen_surface_mesh::types::PlanarFill::min_area_ratio: f64`

Smallest triangle worth improving, as a fraction of [`Self::max_area`]
-- the guard against two contours running close and near-parallel,
where local feature size collapses and an unfloored refinement fills
the wedge with slivers.

### `pub grafting_procgen_surface_mesh::types::PlanarFill::reach_slack: f32`

Multiplier on each curve's own reach when deciding whether the field
claims a corner, absorbing a mitre or a union vertex sitting a hair
outside the swept width.

### `pub grafting_procgen_surface_mesh::types::TriangulatedMesh::indices: alloc::vec::Vec<u32>`

### `pub grafting_procgen_surface_mesh::types::TriangulatedMesh::normals: alloc::vec::Vec<[f32; 3]>`

### `pub grafting_procgen_surface_mesh::types::TriangulatedMesh::positions: alloc::vec::Vec<[f32; 3]>`

### `pub grafting_procgen_surface_mesh::types::TriangulatedMesh::uvs: alloc::vec::Vec<[f32; 2]>`

Where each vertex sits on the surface's own flat extent, **in world
units** -- not normalised to `0..1`.

Metres rather than a unit box is the whole point. A normalised box
stretches: the same texture would cover a 2 m panel and a 10 m one
identically, so a caller would have to undo the normalisation with the
panel's size to get a uniform result, and two panels meeting at a
corner would disagree about where the pattern is. In metres, scale is
uniform everywhere for free, and a caller divides by whatever its own
tile size happens to be.

An upright face measures along its rail and up. A flat one measures
along and across the curve it was swept from -- `(s, t)`, from its
[`PlanarFill`] field -- or, with no such curve, in world `x` and `z`.
All three anchor on something the graph already fixes, so re-deriving
a mesh yields the same coordinates and neighbours that share an anchor
agree across the edge between them.

`(s, t)` is the one worth building on. World `xz` is the face's
*shadow*: it foreshortens wherever the surface is not level and says
nothing about where along a run a point sits. Distance travelled and
distance off, in metres, is the coordinate anything laid out over the
surface actually wants -- a course of replicated units, a marking, a
structure placed at a station -- and it survives the surface being
rebuilt, refined differently or widened, which a vertex index does
not.

### `pub grafting_procgen_surface_mesh::upright::UprightStructure::base_edges: alloc::vec::Vec<(grafting_graph_core::contour::ContourEdge, [f32; 3], [f32; 3])>`

### `pub grafting_procgen_surface_mesh::upright::UprightStructure::frame: grafting_procgen_surface_mesh::frame::UnrollFrame`

### `pub grafting_procgen_surface_mesh::upright::UprightStructure::top_edges: alloc::vec::Vec<(grafting_graph_core::contour::ContourEdge, [f32; 3], [f32; 3])>`

### `pub mod grafting_procgen_surface_mesh`

Turns a construction `Surface`'s node cycle -- an ordered ring of 3D
positions -- into a triangulated mesh. `grafting_graph_core::Surface`
deliberately does not compute this itself (see its module doc: "turning
that into geometry is the caller's job"); this crate is that caller. A
pure `positions -> mesh` function, with no dependency on graph-core's
storage, matching the isolation `terrain-generation`/`structure-generation`
already use for generation-only crates.

`ADR-0022` requires arbitrary (not only convex/rectangular) polygon
support ("a hexagon, an irregular outline"), so triangulation uses the
`earcut` crate (ear-clipping, handles concave simple polygons) rather
than a fan, which only triangulates convex/star-shaped rings correctly.

A curved face keeps exactly the corners a straight one has -- the arc
only exists here, approximated right before triangulation and never
persisted back onto the graph. Tessellation resolution is this crate's
own fixed [`ARC_TESSELLATION_TOLERANCE`], not a value a caller supplies
or the graph stores: controlling render resolution is a rendering
concern, not a construction-time one.

An **upright** face -- a wall panel, straight or curved -- gets there by
being unrolled rather than projected. Its ring does not lie on a plane
when it curves, so a best-fit plane folds it onto itself and emits
triangles that visibly cut across the surface. But the panel is a
developable surface: a section of a cylinder flattens without distortion
into "distance along the rail" and "height", and a straight panel is the
same map with an infinite radius. Unrolled, it is an ordinary 2D polygon
that triangulates like any other -- openings included, which a strip
built facet by facet could never punch.

A flat panel keeps exactly the vertices its contour has: `earcut` invents
none, and on a plane none are needed. A curved panel with an opening does
need them -- the face left around the hole cannot be covered by joining
contour vertices without spanning chords that cut through the inside of
the cylinder -- so that one case is filled with `i_triangle`'s uniform
Delaunay mesh at a bounded edge length and rolled back onto the surface.
The normals are derived from the frame, per vertex, so a curve shades as
a curve.

Those unrolled coordinates also leave the crate, as [`TriangulatedMesh`]'s
`uvs`. They are metres of the surface's own extent, not a normalised
`0..1` box, which is what makes them usable for more than one thing:
anything laid out over a surface -- a tiling texture, a course of
replicated units -- needs the same origin, the same two directions, and
the same extent in metres, so emitting the frame once means both land on
the same grid.

### `pub mod grafting_procgen_surface_mesh::frame`

Frame mappings for developable upright surfaces (straight or curved walls).

### `pub mod grafting_procgen_surface_mesh::math`

Geometric and vector math functions for surface triangulation.

### `pub mod grafting_procgen_surface_mesh::planar`

Planar surface triangulation via best-fit plane projection and earcut.

### `pub mod grafting_procgen_surface_mesh::refine`

Planar triangulation that is allowed to put vertices *inside* the face.

**The defect this exists to remove.** Ear clipping invents nothing: it
covers a ring using only the ring's own corners. For a compact face that
is exactly right and this module never runs. For a long, narrow one -- a
ribbon swept along a curve is the standing example -- it is a
disfigurement. The only way to cover the middle of a ribbon from its
corners alone is to run triangles diagonally from one margin across to
the other, so the interior of the surface becomes a linear blend between
two points that may be tens of metres apart lengthwise. On level ground
nobody notices. On a slope the face visibly twists, and every diagonal
that spans a dip pulls the surface down into a trough that the contour
itself never had.

It is the same failure `upright.rs` already had to answer for a curved
wall panel, where the diagonals cut through the cylinder and left a
helical crease -- and the answer there was the same one in a different
shape: stop asking the triangulator to cover a surface it has no
vertices for.

**How it is answered here.** The ring is handed to a constrained Delaunay
refinement ([`triangulate_constrained`]) instead, which keeps every
supplied corner exactly where it is, never crosses the boundary, and
fills the interior with real vertices up to a bounded triangle size. A
vertex it invents is inside the face and therefore off the contour, so
nothing in the graph can say how high it is -- which is why this module
runs only when a reference field is present to answer that. The field
is also the face's parametrization, so the same call that elevates an
invented vertex also gives it a UV.

Nothing here knows what kind of surface it is looking at. A face gets an
interior when a field claims its corners and its own size warrants one;
that is a statement about geometry, and any surface swept from a curve
answers it the same way without this module or its caller growing a
branch per type.

### `pub mod grafting_procgen_surface_mesh::tessellation`

Tessellation of analytic contour loops into discrete 3D vertex chains.

### `pub mod grafting_procgen_surface_mesh::types`

Data structures and tolerances for surface mesh generation.

### `pub mod grafting_procgen_surface_mesh::upright`

Triangulation of developable upright surfaces (straight or curved wall panels).

### `pub struct grafting_procgen_surface_mesh::PlanarFill<'a>`

What a planar face may put *inside* itself, and on whose authority.

Absent, a face is covered from its own corners alone -- ear clipping,
which is exactly right for a compact face and disfigures a long narrow
one (see [`crate::refine`]). Present, the face is refined to a bounded
triangle size and every vertex the refinement invents is elevated and
parametrized by `field`.

The field is the precondition, not a decoration: an interior vertex is
off the contour, so the graph holds no height for it, and inventing one
is how a surface acquires shape nobody authored.

### `pub struct grafting_procgen_surface_mesh::TriangulatedMesh`

A triangulated mesh derived from one surface's node cycle. Vertices stay
in the caller-supplied cycle order wherever the contour alone can carry
the surface, so `indices` reference the same order as the input
`positions`. The exception is a curved panel with an opening: that one is
filled with a uniform mesh whose interior vertices exist only here, so
`positions` is longer than the contour and in the mesher's own order.

### `pub struct grafting_procgen_surface_mesh::types::PlanarFill<'a>`

What a planar face may put *inside* itself, and on whose authority.

Absent, a face is covered from its own corners alone -- ear clipping,
which is exactly right for a compact face and disfigures a long narrow
one (see [`crate::refine`]). Present, the face is refined to a bounded
triangle size and every vertex the refinement invents is elevated and
parametrized by `field`.

The field is the precondition, not a decoration: an interior vertex is
off the contour, so the graph holds no height for it, and inventing one
is how a surface acquires shape nobody authored.

### `pub struct grafting_procgen_surface_mesh::types::TriangulatedMesh`

A triangulated mesh derived from one surface's node cycle. Vertices stay
in the caller-supplied cycle order wherever the contour alone can carry
the surface, so `indices` reference the same order as the input
`positions`. The exception is a curved panel with an opening: that one is
filled with a uniform mesh whose interior vertices exist only here, so
`positions` is longer than the contour and in the mesher's own order.

### `pub struct grafting_procgen_surface_mesh::upright::UprightStructure`

The rail and structure of an upright face.
