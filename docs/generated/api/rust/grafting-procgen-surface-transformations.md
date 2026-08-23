# grafting-procgen-surface-transformations

### `pub enum grafting_procgen_surface_transformations::BrushShape`

Renderer-neutral convex brush footprint shared by surface and terrain tools.

### `pub enum grafting_procgen_surface_transformations::PathBrushFailure`

Failure while building a path-brush replacement plan.

### `pub enum grafting_procgen_surface_transformations::SweepFormationFailure`

Reusable failures while creating a profile sweep.

### `pub fn grafting_procgen_surface_transformations::AnalyticBrushContour::edge_geometries(&self) -> &[grafting_graph_core::contour::ContourGeometry]`

Geometry for each directed boundary edge.

### `pub fn grafting_procgen_surface_transformations::AnalyticBrushContour::vertices(&self) -> &[[f32; 2]]`

Ordered XZ vertices of this closed contour.

### `pub fn grafting_procgen_surface_transformations::RegionMergePlan::consumed_boundaries(&self) -> &[alloc::vec::Vec<grafting_procgen_surface_transformations::BoundaryVertex>]`

Closed exterior boundaries after shared edges among every consumed
surface and region cancel -- each carrying its own edge geometry
forward, not assuming straight lines.

### `pub fn grafting_procgen_surface_transformations::RegionMergePlan::consumed_region_ids(&self) -> &[grafting_graph_core::contour::RegionId]`

Existing analytic regions the new contour destroys.

### `pub fn grafting_procgen_surface_transformations::RegionMergePlan::contour(&self) -> &grafting_procgen_surface_transformations::AnalyticBrushContour`

The new region's own contour, unchanged from what the caller built.

### `pub fn grafting_procgen_surface_transformations::SweepFormationPlan::boundary(&self) -> &[usize]`

Ordered outer cycle of the complete formation, expressed as vertex indices.

This is the exact rim a terrain replacement uses as its hole boundary;
it never includes an interior strip edge.

### `pub fn grafting_procgen_surface_transformations::SweepFormationPlan::profile_len(&self) -> usize`

Number of profile vertices in every transverse station.

### `pub fn grafting_procgen_surface_transformations::SweepFormationPlan::quads(&self) -> &[[usize; 4]]`

Shared-vertex quad cells between neighbouring stations and profile samples.

### `pub fn grafting_procgen_surface_transformations::SweepFormationPlan::reference_line(&self) -> &[[f32; 3]]`

The stations this formation actually used -- the caller's own line,
less any coincident repeat.

### `pub fn grafting_procgen_surface_transformations::SweepFormationPlan::vertices(&self) -> &[[f32; 3]]`

Generated world-space vertices, arranged one transverse station at a time.

### `pub fn grafting_procgen_surface_transformations::compact_analytic_brush_contour(request: &grafting_procgen_surface_transformations::PathBrushRequest) -> core::result::Result<grafting_procgen_surface_transformations::AnalyticBrushContour, grafting_procgen_surface_transformations::PathBrushFailure>`

Produces one compact contour for the complete pointer batch.

Consecutive fitted primitives become one continuous tube with round joins
and caps. The result is never a list of overlapping per-segment
footprints, so a dense gesture has no more topology than its fitted
lines/arcs require.

### `pub fn grafting_procgen_surface_transformations::plan_region_merge(graph: &grafting_graph_core::model::Graph<[f32; 3], ()>, surfaces: &grafting_graph_core::surface::SurfaceRegistry, topology: &grafting_graph_core::contour::ContourTopology, contour: grafting_procgen_surface_transformations::AnalyticBrushContour, is_eligible: impl core::ops::function::Fn(&grafting_graph_core::surface::SurfaceType) -> bool) -> core::result::Result<grafting_procgen_surface_transformations::RegionMergePlan, grafting_procgen_surface_transformations::PathBrushFailure>`

Plans destroying-and-rebuilding whatever existing surfaces or existing
analytic regions a new region's `contour` touches.

Generic across what counts as eligible to be consumed (`is_eligible`,
tested against each candidate's own `SurfaceType`; a caller wanting no
restriction at all passes `|_| true`) and knows nothing about what kind
of structure produced `contour` -- a path-brush stroke, a future wall
opening, or anything else. Never mutates the graph.

A candidate (a plain surface or an existing region alike) counts as
touched either way a shape can overlap a face without crossing the
other's own vertices: a corner landing inside the new contour, or the
contour's own boundary passing through the candidate's interior
(cutting straight through the middle of a face touches no corner at
all). This step then cancels interior shared edges among every touched
candidate once -- surfaces and regions together, in one pool, so a
region bordering a plain surface (or another region) cancels exactly
the same way two plain surfaces already did -- and keeps only the
exterior loops, the prerequisite for a caller replacing an entire
consumed patch with one region-with-a-hole instead of emitting a
fragment for every original piece.

**Known scope limit:** only a consumed region's *outer* loop(s)
participate in cancellation -- a hole already inside a consumed region
(an even earlier stroke's own cutout) is not carried forward as a hole
of the new remainder. A stroke that fully re-covers a multi-generation
hole "heals" it instead of preserving it. Narrower than the total
invisibility this replaces, but not a complete fix.

### `pub fn grafting_procgen_surface_transformations::plan_region_merge_regions(graph: &grafting_graph_core::model::Graph<[f32; 3], ()>, surfaces: &grafting_graph_core::surface::SurfaceRegistry, topology: &grafting_graph_core::contour::ContourTopology, contour: grafting_procgen_surface_transformations::AnalyticBrushContour, is_eligible: impl core::ops::function::Fn(&grafting_graph_core::contour::RegionId, &grafting_graph_core::surface::SurfaceType) -> bool) -> core::result::Result<grafting_procgen_surface_transformations::RegionMergePlan, grafting_procgen_surface_transformations::PathBrushFailure>`

Plans a region overlay with eligibility resolved against exact region
identities as well as semantic surface types.

This is the application-orchestrated form of [`plan_region_merge`]: a
caller first queries coverage and resolves product policy, then supplies
the precise region set selected by that decision. Geometry remains in
Rust; product policy does not.

### `pub fn grafting_procgen_surface_transformations::plan_sweep_formation(request: &grafting_procgen_surface_transformations::SweepFormationRequest) -> core::result::Result<grafting_procgen_surface_transformations::SweepFormationPlan, grafting_procgen_surface_transformations::SweepFormationFailure>`

Samples a transverse profile along a reference line into connected quads.

Every station comes from the caller: this places none of its own, and
invents no position or height that was not handed to it. Deciding where
the stations go is inseparable from knowing what the formation runs over
-- the ground it rides, how finely that ground varies -- and none of that
is knowable here. A caller that wants denser stations spaces them itself.

Outer boundaries and interior strips share the exact same vertex indices,
so a caller can turn the plan into a manifold graph patch without welding
coincident geometry.

### `pub fn grafting_procgen_surface_transformations::polygonal_contour(vertices: alloc::vec::Vec<[f32; 2]>) -> core::result::Result<grafting_procgen_surface_transformations::AnalyticBrushContour, grafting_procgen_surface_transformations::PathBrushFailure>`

Creates a straight-edged contour from an already-normalized exterior loop.

A profile sweep uses this for its exact outer rim before the generic
region-merge planner decides which existing surfaces must be replaced.

### `pub fn grafting_procgen_surface_transformations::swept_brush_contains(shape: &grafting_procgen_surface_transformations::BrushShape, samples: &[[f32; 2]], point: [f32; 2]) -> bool`

Returns whether `point` lies in the continuous sweep of `shape` over `samples`.

This is the shared authoritative footprint query used by terrain-cell
generation and surface transformations, so both tools interpret brush
shape, rotation, and gaps between pointer samples identically.

### `pub fn grafting_procgen_surface_transformations::validate_request(request: &grafting_procgen_surface_transformations::PathBrushRequest) -> core::result::Result<(), grafting_procgen_surface_transformations::PathBrushFailure>`

Validates a path-brush request's own scalar/geometric fields (operation
identity, samples, shape, depth) -- the path-specific checks
`plan_region_merge` itself has no reason to know about, since it takes
an already-built contour and a plain eligibility predicate, not a
`PathBrushRequest`. A caller building a path-brush stroke on top of that
generic planner calls this first.

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

### `pub grafting_procgen_surface_transformations::PathBrushFailure::NoChanges`

No source surface had a semantic delta, so no operation may be committed.

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

### `pub grafting_procgen_surface_transformations::SweepFormationFailure::InvalidMiterLimit`

The requested corner miter limit is invalid.

### `pub grafting_procgen_surface_transformations::SweepFormationFailure::InvalidProfile`

The profile is not finite, has fewer than two points, or is unordered.

### `pub grafting_procgen_surface_transformations::SweepFormationFailure::InvalidReferenceLine`

The reference line does not contain two distinct finite points.

### `pub grafting_procgen_surface_transformations::SweepFormationRequest::miter_limit: f32`

Largest allowed corner miter, expressed as a multiple of lateral offset.

### `pub grafting_procgen_surface_transformations::SweepFormationRequest::profile: alloc::vec::Vec<grafting_procgen_surface_transformations::TransverseProfilePoint>`

Strictly left-to-right cross-section samples.

### `pub grafting_procgen_surface_transformations::SweepFormationRequest::reference_line: alloc::vec::Vec<[f32; 3]>`

Ordered reference-line samples as `[x, y, z]`.

The line carries its own height, so a formation rides whatever it was
drawn along rather than lying on the world floor. One station is
emitted per point given: their spacing is the caller's decision, and
nothing here adds to them or reads a height it was not handed.

### `pub grafting_procgen_surface_transformations::TransverseProfilePoint::elevation: f32`

World-space Y coordinate at this lateral offset.

### `pub grafting_procgen_surface_transformations::TransverseProfilePoint::lateral_offset: f32`

Signed world-space distance from the reference line.

### `pub mod grafting_procgen_surface_transformations`

Deterministic planning for local construction-surface transformations.

This crate owns authoritative brush/surface intersection, contour
formation, and merge planning. It never mutates a graph: callers receive
one plan for the whole confirmed stroke and apply it themselves.

### `pub struct grafting_procgen_surface_transformations::AnalyticBrushContour`

One closed analytic contour, with one geometry entry for every directed
edge from `vertices[index]` to `vertices[(index + 1) % vertices.len()]`.

This is intentionally independent of graph identities. The construction
session assigns stable node and contour-edge ids only after a contour has
been accepted as one semantic brush operation.

### `pub struct grafting_procgen_surface_transformations::PathBrushRequest`

One convex brush stroke resolved in construction-world XZ space.

### `pub struct grafting_procgen_surface_transformations::RegionMergePlan`

One region-overlay merge plan: which existing surfaces and existing
analytic regions a new region's contour destroys, their cancelled
exterior boundaries (what a leftover remainder region must carry as its
own hole), and the contour itself.

Nothing here is specific to any one tool. Any application operation that
overlays one new closed shape onto the current graph and replaces what
it covers can reuse this
unchanged -- see [`plan_region_merge`]. Consuming an existing *region*
(not just a plain surface) matters as soon as more than one such
overlay can happen in the same place: without it, a second stroke can
never touch, cut, or remove what an earlier one already created, and it
just sits there orphaned forever.

### `pub struct grafting_procgen_surface_transformations::SweepFormationPlan`

Graph-neutral result of sweeping a profile along a reference line.

Vertices are arranged station-major: every consecutive `profile_len`
entries form one transverse station. Each quad references those shared
vertices, so neighbouring strips are topologically connected by design.

### `pub struct grafting_procgen_surface_transformations::SweepFormationRequest`

Input for one deterministic profile sweep.

### `pub struct grafting_procgen_surface_transformations::TransverseProfilePoint`

One sample of a formation's transverse profile.

`lateral_offset` is measured left/right from the reference line in world
units. `elevation` is measured **from the reference line's own height at
that station**, not from the world floor, so one profile describes the
same cross-section wherever the line happens to run. Callers own the
policy that decides which elevations are valid for their product.

### `pub type grafting_procgen_surface_transformations::BoundaryVertex = (grafting_graph_core::model::NodeId, grafting_graph_core::contour::ContourGeometry)`

One vertex of a cancelled exterior boundary, paired with the geometry of
the edge leading from it to the *next* vertex in the same boundary
(wrapping from the last vertex back to the first). Unlike a plain
surface's cycle (always straight), a consumed analytic region's own
edges can be curved, and the remainder boundary this vertex ends up in
must keep that curve, not silently flatten it to a line.
