# grafting-procgen-surface-mesh

### `pub fn grafting_procgen_surface_mesh::triangulate_region(topology: &grafting_graph_core::contour::ContourTopology, region: &grafting_graph_core::contour::SurfaceRegion, resolve_position: impl core::ops::function::FnMut(&grafting_graph_core::model::NodeId) -> core::option::Option<[f32; 3]>) -> core::option::Option<alloc::vec::Vec<grafting_procgen_surface_mesh::TriangulatedMesh>>`

Derives transient meshes for every outer loop in an analytic contour
region. Lines and circular arcs remain analytic in graph state; this is
the first point where an arc is approximated for GPU consumption.

Holes are assigned to the outer loop that contains their first point in
the XZ contour plane. An invalid hole that is outside every outer loop
produces `None` rather than a visually plausible but topologically false
mesh. Callers resolve node positions from their authoritative graph.

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

An upright face measures along its rail and up; a flat one measures in
world `x` and `z`. Both anchor on something the graph already fixes, so
re-deriving a mesh yields the same coordinates and neighbours that share
an anchor agree across the edge between them.

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
that `earcut` triangulates like any other -- openings included, which a
strip built facet by facet could never punch.

The 3D positions never move: the unrolled coordinates are where `earcut`
works, and `earcut` introduces no vertices of its own. The normals are
derived from the frame, per vertex, so a curve shades as a curve.

Those unrolled coordinates also leave the crate, as [`TriangulatedMesh`]'s
`uvs`. They are metres of the surface's own extent, not a normalised
`0..1` box, which is what makes them usable for more than one thing:
anything laid out over a surface -- a tiling texture, a course of
replicated units -- needs the same origin, the same two directions, and
the same extent in metres, so emitting the frame once means both land on
the same grid.

### `pub struct grafting_procgen_surface_mesh::TriangulatedMesh`

A triangulated mesh derived from one surface's node cycle. Vertices stay
in the caller-supplied cycle order (no Steiner points are introduced for
the simple, hole-free polygons this domain produces), so `indices`
reference the same order as the input `positions`.
