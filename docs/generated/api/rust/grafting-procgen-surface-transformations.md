# grafting-procgen-surface-transformations

### `pub enum grafting_procgen_surface_transformations::PathBrushFailure`

Failure while building a path-brush replacement plan.

### `pub fn grafting_procgen_surface_transformations::plan_path_brush(graph: &grafting_graph_core::model::Graph<[f32; 3], ()>, surfaces: &grafting_graph_core::surface::SurfaceRegistry, request: &grafting_procgen_surface_transformations::PathBrushRequest) -> core::result::Result<grafting_graph_core::construction::SurfaceReplacementPlan<[f32; 3], ()>, grafting_procgen_surface_transformations::PathBrushFailure>`

Plans a terrain-to-path transformation without mutating `graph` or `surfaces`.

For each eligible convex face, the first slice accepts either a footprint
containing the whole face or a footprint wholly inside it. The latter is
split into deterministic terrain ring sectors and a path fan whose new
centre node has `depth` applied, producing the initial shallow U profile.
New IDs derive only from `operation_id`, source surface identity, and their
stable local index.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::CrossesSurfaceBoundary`

The footprint intersects a surface but crosses its external boundary.

This first capability slice deliberately supports complete coverage and
a closed footprint strictly inside one convex terrain face. Crossing an
existing face boundary is rejected atomically until the follow-up
boundary-stitching transformer can preserve shared-edge ownership.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::CrossesSurfaceBoundary::key: grafting_graph_core::surface::SurfaceKey`

Surface whose external cycle would need shared-edge stitching.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::InvalidBrush`

Radius or depth was non-finite or not strictly positive.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::InvalidOperationId`

The request identity could not become a graph identifier.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::NoChanges`

No source surface had a semantic delta, so no operation may be committed.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::NonConvexSurface`

An eligible surface was not a convex polygon in XZ space.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::NonConvexSurface::key: grafting_graph_core::surface::SurfaceKey`

Surface whose XZ cycle is not convex.

### `pub grafting_procgen_surface_transformations::PathBrushFailure::Plan(grafting_graph_core::transformation_plan::TransformationPlanFailure)`

The generic plan contract rejected the generated lifecycle data.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::center: [f32; 2]`

Brush centre in XZ coordinates.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::depth: f32`

Maximum downward displacement at the path centre.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::operation_id: alloc::string::String`

Caller-stable identity used only to make newly introduced graph IDs deterministic.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::radius: f32`

Circular footprint radius in world units.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::source_type: grafting_graph_core::surface::SurfaceType`

Source type eligible for local replacement.

### `pub grafting_procgen_surface_transformations::PathBrushRequest::target_type: grafting_graph_core::surface::SurfaceType`

Type assigned to the painted local region.

### `pub mod grafting_procgen_surface_transformations`

Deterministic planning for local construction-surface transformations.

This crate owns domain geometry and formation semantics, but never mutates
a graph. A caller submits its [`PathBrushRequest`] with a graph/surface
snapshot and receives a generic [`SurfaceReplacementPlan`] that
`grafting-graph-core` can validate and publish atomically.

### `pub struct grafting_procgen_surface_transformations::PathBrushRequest`

One circular brush footprint resolved in construction-world XZ space.
