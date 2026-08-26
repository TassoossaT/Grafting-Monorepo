# grafting-procgen-curve-offset

### `pub fn grafting_procgen_curve_offset::offset_bands(polyline: &grafting_procgen_curve_offset::Polyline, band_offsets: &[f32], miter_limit: f32) -> alloc::vec::Vec<grafting_procgen_curve_offset::Polygon>`

One ribbon polygon per consecutive pair of `band_offsets` -- the band
between offset `k` and offset `k + 1`, following `polyline`'s own shape.
`band_offsets` need not be sorted by sign, only ordered the way the
caller wants its bands to read (mirrors a cross-section profile's list of
lateral offsets, left-to-right across the run).

Returns no bands for a polyline with fewer than two points or a profile
with fewer than two offsets -- there is no span to sweep along, or no gap
between offsets to call a band.

### `pub fn grafting_procgen_curve_offset::sample_catmull_rom(control_points: &[grafting_procgen_curve_offset::Point], tolerance: f32) -> grafting_procgen_curve_offset::Polyline`

Samples a centripetal Catmull-Rom curve through `control_points`,
flattened so no chord strays from the true curve by more than
`tolerance`. The curve passes through every control point in order; the
phantom point beyond either end is a reflection of that end's own last
chord (see [`reflect`]), not a loop and not a duplicate, so the curve
does not overshoot past either end.

Collinear control points flatten to their own straight chords, however
unevenly they are spaced -- collinear is collinear under any
parametrization -- so the result is exactly `control_points` back.

### `pub fn grafting_procgen_curve_offset::union_and_triangulate(polygons: &[grafting_procgen_curve_offset::Polygon]) -> grafting_procgen_curve_offset::TriangulatedMesh`

Unions every polygon's outer ring and holes together (`FillRule::NonZero`,
the same rule `grafting-procgen-surface-transformations`'s
`union_stroke_footprint` already uses for brush strokes) and triangulates
each resulting shape with `earcut` -- the same crate
`grafting-procgen-surface-mesh` already triangulates simple planar rings
with. A T, an X, or an L of overlapping bands all fall out of this one
call with no per-topology branch: the union either merges two bands into
one face or it doesn't, and both are the same code path.

### `pub grafting_procgen_curve_offset::Polygon::holes: alloc::vec::Vec<alloc::vec::Vec<grafting_procgen_curve_offset::Point>>`

### `pub grafting_procgen_curve_offset::Polygon::outer: alloc::vec::Vec<grafting_procgen_curve_offset::Point>`

### `pub grafting_procgen_curve_offset::Polyline::points: alloc::vec::Vec<grafting_procgen_curve_offset::Point>`

### `pub grafting_procgen_curve_offset::TriangulatedMesh::indices: alloc::vec::Vec<u32>`

### `pub grafting_procgen_curve_offset::TriangulatedMesh::positions: alloc::vec::Vec<grafting_procgen_curve_offset::Point>`

### `pub mod grafting_procgen_curve_offset`

Generic curve, offset, and polygon-union primitives for construction
generation. Stateless pure geometry -- no dependency on
`grafting-graph-core`, and no vocabulary for what a curve or a band is
*for* (a road, a path, anything else): this crate only knows points,
polylines, polygons, and meshes, matching the isolation
`grafting-procgen-surface-mesh` already uses for generation-only crates.
A composition layer decides what a curve means; this crate only turns
control points into a flattened curve, a flattened curve into banded
ribbons, and any number of ribbons into one unioned, triangulated mesh.

### `pub struct grafting_procgen_curve_offset::Polygon`

A simple closed ring plus any holes it encloses.

### `pub struct grafting_procgen_curve_offset::Polyline`

An ordered, open sequence of points -- a curve already flattened to
straight segments.

### `pub struct grafting_procgen_curve_offset::TriangulatedMesh`

A flat 2D triangulated mesh: no separate `normals`/`uvs`, unlike
`grafting-procgen-surface-mesh`'s `TriangulatedMesh` -- those are a
world-position concern a caller adds once the union's own planar shape
has been decided.

### `pub type grafting_procgen_curve_offset::Point = [f32; 2]`

A point on the plane the caller is working in. Height is not this
crate's concern -- a caller that rides terrain or spans a deck
interpolates elevation separately, the same way `apps/vtt`'s
`sweep-formation.ts` already keeps height off its own reference line's
planar math.
