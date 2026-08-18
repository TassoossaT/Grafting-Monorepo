# grafting-procgen-surface-mesh

### `pub fn grafting_procgen_surface_mesh::triangulate_surface(positions: &[[f32; 3]], curvature: core::option::Option<grafting_graph_core::surface::SurfaceCurvature>) -> core::option::Option<grafting_procgen_surface_mesh::TriangulatedMesh>`

Triangulates a simple (hole-free) polygon given by `positions` -- an
ordered ring, e.g. `Surface::cycle()`'s node ids resolved to their
current graph positions. When `curvature` is given and `positions` is
exactly the 4-corner shape [`crate`]'s own doc describes (bottom start,
bottom end, top end, top start), the two curved edges are tessellated
into a many-point ring first, at [`ARC_TESSELLATION_TOLERANCE`]. Returns `None` for
fewer than 3 positions or a degenerate (collinear/zero-area) ring; both
are states a caller may see transiently mid-edit, not error conditions
to propagate.

### `pub grafting_procgen_surface_mesh::TriangulatedMesh::indices: alloc::vec::Vec<u32>`

### `pub grafting_procgen_surface_mesh::TriangulatedMesh::normals: alloc::vec::Vec<[f32; 3]>`

### `pub grafting_procgen_surface_mesh::TriangulatedMesh::positions: alloc::vec::Vec<[f32; 3]>`

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

A curved `Surface` (see [`grafting_graph_core::SurfaceCurvature`]) keeps
exactly 4 graph-cycle corners, the same as a straight one -- the actual
arc only exists here, tessellated into a strip of quads right before
triangulation, never persisted back onto the graph. Tessellation
resolution is this crate's own fixed [`ARC_TESSELLATION_TOLERANCE`], not
a value a caller supplies or the graph stores -- controlling render
resolution is a rendering concern, not a construction-time one.

That strip is built directly (a triangle per half of each tessellated
quad segment), **not** by flattening the curve into one many-point ring
and handing it to `earcut` -- a curved wall's mesh is a section of a
cylinder, so its vertices do not lie on one flat plane, and `earcut`'s
own 3D-to-2D projection assumes (near-)planarity. Folding a real curve
onto that best-fit plane self-intersects in 2D for anything but the
shallowest arc, producing triangles that visibly cut across the surface
instead of following it.

### `pub struct grafting_procgen_surface_mesh::TriangulatedMesh`

A triangulated mesh derived from one surface's node cycle. Vertices stay
in the caller-supplied cycle order (no Steiner points are introduced for
the simple, hole-free polygons this domain produces), so `indices`
reference the same order as the input `positions`.
