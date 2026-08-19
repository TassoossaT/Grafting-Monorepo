# grafting-procgen-surface-transformations

### `pub enum grafting_procgen_surface_transformations::BrushShape`

Renderer-neutral convex brush footprint shared by surface and terrain tools.

### `pub enum grafting_procgen_surface_transformations::PathBrushFailure`

Failure while building a path-brush replacement plan.

### `pub fn grafting_procgen_surface_transformations::AnalyticBrushContour::edge_geometries(&self) -> &[grafting_graph_core::contour::ContourGeometry]`

Geometry for each directed boundary edge.

### `pub fn grafting_procgen_surface_transformations::AnalyticBrushContour::vertices(&self) -> &[[f32; 2]]`

Ordered XZ vertices of this closed contour.

### `pub fn grafting_procgen_surface_transformations::compact_analytic_brush_contour(request: &grafting_procgen_surface_transformations::PathBrushRequest) -> core::result::Result<grafting_procgen_surface_transformations::AnalyticBrushContour, grafting_procgen_surface_transformations::PathBrushFailure>`

Produces one compact contour for the complete pointer batch.

Consecutive fitted primitives become one continuous tube with round joins
and caps. The result is never a list of overlapping per-segment
footprints, so a dense gesture has no more topology than its fitted
lines/arcs require.

### `pub fn grafting_procgen_surface_transformations::plan_path_brush(graph: &grafting_graph_core::model::Graph<[f32; 3], ()>, surfaces: &grafting_graph_core::surface::SurfaceRegistry, request: &grafting_procgen_surface_transformations::PathBrushRequest) -> core::result::Result<grafting_graph_core::construction::SurfaceReplacementPlan<[f32; 3], ()>, grafting_procgen_surface_transformations::PathBrushFailure>`

Plans a continuous terrain-to-path transformation without mutating state.

The complete pointer batch is first fitted to straight lines and true arcs,
so input frequency never controls graph density. Existing small terrain
cells are retyped in place and their shared nodes receive the analytic
U-shaped profile. Only a genuinely coarse source polygon is partitioned
against the sweep; its cut positions are interned and all resulting changes
are published as one atomic replacement plan.

### `pub fn grafting_procgen_surface_transformations::swept_brush_contains(shape: &grafting_procgen_surface_transformations::BrushShape, samples: &[[f32; 2]], point: [f32; 2]) -> bool`

Returns whether `point` lies in the continuous sweep of `shape` over `samples`.

This is the shared authoritative footprint query used by terrain-cell
generation and surface transformations, so both tools interpret brush
shape, rotation, and gaps between pointer samples identically.

### `pub grafting_procgen_surface_transformations::BrushShape::Circle`

A circular footprint approximated deterministically for graph clipping.

### `pub grafting_procgen_surface_transformations::BrushShape::Circle::radius: f32`

World-space radius.

### `pub grafting_procgen_surface_transformations::BrushShape::Hexagon`

A rotated regular hexagonal footprint.

### `pub grafting_procgen_surface_transformations::BrushShape::Hexagon::radius: f32`

World-space circumradius.

### `pub grafting_procgen_surface_transformations::BrushShape::Hexagon::rotation_radians: f32`

Rotation around world Y in radians.

### `pub grafting_procgen_surface_transformations::BrushShape::Square`

A rotated square footprint.

### `pub grafting_procgen_surface_transformations::BrushShape::Square::rotation_radians: f32`

Rotation around world Y in radians.

### `pub grafting_procgen_surface_transformations::BrushShape::Square::size: f32`

Full world-space side length.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::InvalidBrush`

Samples, shape, or depth are missing, non-finite, or not positive where required.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::InvalidOperationId`

The request identity could not become a graph identifier.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::InvalidSourceSurface`

An eligible source surface could not be triangulated safely.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::InvalidSourceSurface::key: grafting_graph_core::surface::SurfaceKey`

Surface that could not participate in the transformation.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::NoChanges`

No source surface had a semantic delta, so no operation may be committed.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::Plan(grafting_graph_core::transformation_plan::TransformationPlanFailure)`

The generic plan contract rejected the generated lifecycle data.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::RequiresNormalizedBrushUnion`

A stroke needs full planar union normalization before it can be
represented as one non-overlapping analytic contour.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::depth: f32`

Maximum downward displacement at the path centre line.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::operation_id: alloc::string::String`

Caller-stable identity used to make introduced graph IDs deterministic.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::samples: alloc::vec::Vec<[f32; 2]>`

Ordered pointer samples forming the confirmed stroke.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::shape: grafting_procgen_surface_transformations::BrushShape`

Convex footprint applied at every resampled stroke point.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::source_types: alloc::vec::Vec<grafting_graph_core::surface::SurfaceType>`

Source types eligible for local replacement in the same atomic stroke.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::target_type: grafting_graph_core::surface::SurfaceType`

Type assigned to the painted local region.

### `pub mod grafting_procgen_surface_transformations`

Deterministic planning for local construction-surface transformations.

This crate owns authoritative brush/surface intersection, topology rebuilding,
and path formation. It never mutates a graph: callers receive one atomic
[`SurfaceReplacementPlan`] for the whole confirmed stroke.

### `pub struct grafting_procgen_surface_transformations::AnalyticBrushContour`

One closed analytic contour, with one geometry entry for every directed
edge from `vertices[index]` to `vertices[(index + 1) % vertices.len()]`.

This is intentionally independent of graph identities. The construction
session assigns stable node and contour-edge ids only after a contour has
been accepted as one semantic brush operation.

### `pub struct grafting_procgen_surface_transformations::PathBrushRequest`

One convex brush stroke resolved in construction-world XZ space.
